"""Current shipped knowledge retention, serial Haiku calls, no hidden retries."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
HARD = HERE.parent / 'hard'
FLAGS = ['--tools', '', '--setting-sources', '', '--strict-mcp-config',
         '--no-session-persistence', '--max-turns', '1', '--disable-slash-commands',
         '--safe-mode', '--permission-prompts', 'none']
TOTAL_CAP = 5.0
RESERVE = 0.05


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def append(path, row):
    with path.open('a') as stream:
        stream.write(json.dumps(row, ensure_ascii=False) + '\n')
        stream.flush()
        os.fsync(stream.fileno())


def read_rows(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def bridge(action, **data):
    proc = subprocess.run(['pnpm', 'exec', 'tsx', '--tsconfig', str(REPO / 'tsconfig.json'), str(HERE / 'bridge.mts')],
                          input=json.dumps({'action': action, **data}), text=True,
                          capture_output=True, cwd=REPO, env=clean_env(), check=True)
    return json.loads(proc.stdout)


def clean_env():
    allowed = {'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE',
               'TERM', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'}
    return {k: v for k, v in os.environ.items() if k in allowed}


def runtime_versions():
    versions = {'python': sys.version.split()[0]}
    for name in ('claude', 'node', 'pnpm'):
        versions[name] = subprocess.check_output([name, '--version'], text=True, env=clean_env()).strip()
    return versions


def source_hashes():
    paths = [REPO / 'examples/criteria/knowledge_retention.yaml', REPO / 'pnpm-lock.yaml',
             REPO / 'tsconfig.json', REPO / 'tsconfig.base.json', REPO / 'package.json',
             REPO / 'pnpm-workspace.yaml', HERE / 'bridge.mts', HERE / 'run.py']
    for package in ('judges', 'core'):
        paths.extend((REPO / 'packages' / package / 'src').rglob('*.ts'))
        paths.append(REPO / 'packages' / package / 'package.json')
    return {str(p.relative_to(REPO)): digest(p.read_bytes()) for p in sorted(paths)}


def ensure_phase(phase, state):
    if phase == 'tuning' and ((state / 'freeze.json').exists() or (state / 'heldout-started.json').exists()):
        raise ValueError('Tuning prohibited after candidate freeze or heldout start')
    if phase == 'heldout' and (state / 'heldout-started.json').exists():
        raise ValueError('Heldout already started; a second evaluation is prohibited, including after failure')


def freeze(state, selected):
    ensure_phase('tuning', state)
    if selected.resolve().parent != state.resolve():
        raise ValueError('Selected tuning report must be in the evidence directory')
    report = json.loads(selected.read_text())
    if report['phase'] != 'tuning' or not report.get('complete') or report.get('criterion_override'):
        raise ValueError('Freeze requires a complete tuning report')
    current = source_hashes()
    if report['source_sha256'] != current:
        raise ValueError('Selected tuning report does not measure current production inputs')
    if report['sets_sha256'] != digest((HARD / 'sets.json').read_bytes()):
        raise ValueError('Selected tuning corpus changed')
    frozen = {'timestamp': now(), 'source_sha256': current,
              'selection_report': selected.name, 'selection_sha256': digest(selected.read_bytes()),
              'corpus_sha256': {name: digest((HARD / name).read_bytes())
                                for name in ('sets.json', 'sets-heldout.json')},
              'rule': 'One heldout evaluation, no subsequent tuning; failures consume the attempt.'}
    write(state / 'freeze.json', frozen)
    return frozen


def verify_frozen(state):
    frozen = json.loads((state / 'freeze.json').read_text())
    if frozen['source_sha256'] != source_hashes():
        raise ValueError('Production or harness inputs changed after freeze')
    selected = state / frozen['selection_report']
    if selected.resolve().parent != state.resolve() or digest(selected.read_bytes()) != frozen['selection_sha256']:
        raise ValueError('Selected tuning report changed after freeze')
    for name, sha in frozen['corpus_sha256'].items():
        if digest((HARD / name).read_bytes()) != sha:
            raise ValueError('Corpus changed after freeze')
    return frozen


def budget_used(path):
    # A reservation survives process death. A matching settlement replaces it.
    amounts = {}
    for row in read_rows(path):
        value = row['charged_usd']
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            raise ValueError('Invalid budget ledger')
        amounts[row['call_id']] = value
    return sum(amounts.values())


def reserve_call(path, run_spent, cap, key):
    if run_spent + RESERVE > cap + 1e-12 or budget_used(path) + RESERVE > TOTAL_CAP + 1e-12:
        raise ValueError('Spend cap reached before invocation')
    call_id = str(uuid.uuid4())
    append(path, {'call_id': call_id, 'request_sha256': key, 'charged_usd': RESERVE,
                  'reservation': True, 'timestamp': now()})
    return call_id


def safe_record(row, private):
    # Preserve stdout/result/usage, remove host path and account metadata from public envelopes.
    encoded = json.dumps(row, ensure_ascii=False)
    sensitive = [str(Path.home())]
    identifier = Path.home() / '.driftbench/private/deepeval-hard/operator-email.txt'
    if identifier.exists() and identifier.read_text().strip():
        sensitive.append(identifier.read_text().strip())
    if any(value in row['system'] or value in row['user'] for value in sensitive):
        raise ValueError('Operator identifier in input; publication blocked')
    # Email addresses in the fictional case remain evidence; unknown response emails are masked.
    emails = set(re.findall(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', encoded))
    input_text = row['system'] + row['user']
    sensitive.extend(email for email in emails if email not in input_text)
    if any(value in encoded for value in sensitive):
        private.mkdir(parents=True, exist_ok=True, mode=0o700)
        private.chmod(0o700)
        target = private / 'originals.jsonl'
        descriptor = os.open(target, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, 'a') as stream:
            stream.write(encoded + '\n')
        for value in sensitive:
            encoded = encoded.replace(value, '[redacted-operator-identifier]')
        row = json.loads(encoded)
        row['privacy_redacted'] = True
    return row


def invoke(prompt, key, budget, cap, spent, ledger, tag):
    call_id = reserve_call(budget, spent, cap, key)
    row = {'call_id': call_id, 'request_sha256': key, 'requested_model': 'haiku',
           'timestamp': now(), 'flags': FLAGS, 'system': prompt['system'], 'user': prompt['user']}
    args = ['claude', '-p', '--output-format', 'json', '--model', 'haiku',
            '--system-prompt', prompt['system'], *FLAGS, '--max-budget-usd', str(RESERVE)]
    # Empty directory outside the repo and HOME. Safe mode also disables CLAUDE.md discovery.
    with tempfile.TemporaryDirectory(prefix='driftbench-retention-', dir='/tmp') as cwd:
        env = clean_env()
        try:
            proc = subprocess.run(args, input=prompt['user'], text=True, capture_output=True,
                                  cwd=cwd, env=env, timeout=180)
            row.update(stdout=proc.stdout, stderr=proc.stderr, returncode=proc.returncode)
            envelope = json.loads(proc.stdout)
            cost = envelope.get('total_cost_usd')
            if not isinstance(cost, (int, float)) or not math.isfinite(cost) or cost < 0:
                raise ValueError('Missing or invalid reported cost')
            row.update(result=envelope.get('result', ''), charged_usd=cost,
                       usage=envelope.get('usage'), model_usage=envelope.get('modelUsage'),
                       actual_models=list((envelope.get('modelUsage') or {}).keys()))
            if proc.returncode or envelope.get('is_error') or envelope.get('subtype') != 'success':
                row['error'] = 'CLI invocation did not return a successful answer'
            if not row['actual_models'] or any('haiku' not in m.lower() for m in row['actual_models']):
                row['error'] = 'CLI did not report the requested Haiku model identity'
        except Exception as exc:
            row.update(error=type(exc).__name__, result='', charged_usd=row.get('charged_usd', RESERVE),
                       cost_is_reservation='charged_usd' not in row)
    append(budget, {'call_id': call_id, 'charged_usd': row['charged_usd'],
                    'reservation': row.get('cost_is_reservation', False), 'timestamp': now()})
    with ledger.open('a') as stream:
        stream.write(f"| {now()} | retention-fix {tag} | 1 | {0 if row.get('cost_is_reservation') else row['charged_usd']:.8f} | {row['charged_usd'] if row.get('cost_is_reservation') else 0:.8f} | {call_id} |\n")
        stream.flush()
        os.fsync(stream.fileno())
    return safe_record(row, HERE / '.runtime/private')


def historical_comparison(rows, phase, corpus_sha):
    path = HARD / ('baseline-heldout.json' if phase == 'heldout' else 'baseline-v3.json')
    old = json.loads(path.read_text())
    if old['sets_sha256'] != corpus_sha:
        raise ValueError('Historical comparison corpus hash differs')
    prior = {r['id']: r for r in old['rows'] if r['set'] == 'knowledge'}
    if set(prior) != {r['id'] for r in rows}:
        raise ValueError('Historical comparison case set differs')
    comparisons = {}
    for side, label in [('ours', 'historical_driftbench'), ('theirs', 'deepeval_4_2_8')]:
        b = c = old_correct = 0
        for row in rows:
            previous = prior[row['id']]
            if previous['truth'] is not row['truth']:
                raise ValueError('Historical truth differs')
            hit = row['prediction'] is row['truth']
            old_hit = previous[side]['prediction'] is row['truth']
            old_correct += old_hit
            b += hit and not old_hit
            c += old_hit and not hit
        n = b + c
        comparisons[label] = {'correct': old_correct, 'n': len(rows), 'current_only_right': b,
                              'historical_only_right': c,
                              'paired_exact_p': min(1, 2 * sum(math.comb(n, j) for j in range(min(b, c)+1)) / 2**n) if n else 1}
    return {'source': str(path.relative_to(REPO)), 'source_sha256': digest(path.read_bytes()), **comparisons}


def evaluate(args):
    ensure_phase(args.phase, HERE)
    if args.phase == 'heldout' and not args.record:
        raise ValueError('Heldout requires --record; use the saved report for free analysis')
    target = HERE / (args.tag + '.json')
    if target.exists():
        raise ValueError('Report exists; choose a unique tuning tag')
    if args.phase == 'heldout':
        verify_frozen(HERE)
        # Exclusive persistent marker is written before any heldout content is parsed.
        with (HERE / 'heldout-started.json').open('x') as stream:
            json.dump({'timestamp': now(), 'tag': args.tag}, stream)
    corpus = HARD / ('sets-heldout.json' if args.phase == 'heldout' else 'sets.json')
    cases = json.loads(corpus.read_text())['knowledge']
    if len({r['id'] for r in cases}) != len(cases) or any(type(r['truth']) is not bool for r in cases):
        raise ValueError('Invalid corpus IDs or labels')
    current = source_hashes()
    versions = runtime_versions()
    prompts = bridge('render', criterion=str(args.criterion) if args.criterion else None, cases=[{'id': r['id'], 'turns': r['turns']} for r in cases])
    output = {'phase': args.phase, 'tag': args.tag, 'timestamp': now(), 'source_sha256': current,
              'sets_sha256': digest(corpus.read_bytes()), 'expected_cases': len(cases),
              'model': 'haiku', 'flags': FLAGS, 'runtime': versions, 'criterion_override': bool(args.criterion),
              'criterion_sha256': digest(args.criterion.read_bytes()) if args.criterion else None, 'rows': [], 'fresh_usd': 0, 'complete': False}
    target = HERE / (args.tag + '.json')
    if target.exists():
        raise ValueError('Report exists; choose a unique tuning tag')
    write(HERE / (args.tag + '-prompts.json'), prompts)
    cache = {r['request_sha256']: r for r in read_rows(HERE / 'calls.jsonl') if not r.get('error')}
    try:
        for case, prompt in zip(cases, prompts, strict=True):
            if source_hashes() != current:
                raise ValueError('Production inputs changed during evaluation')
            key = digest(json.dumps(['haiku', versions['claude'], FLAGS, prompt['system'], prompt['user']], ensure_ascii=False).encode())
            if key in cache and args.phase == 'tuning':
                record = cache[key]
            elif not args.record:
                raise ValueError('Replay miss; explicit --record is required for paid calls')
            else:
                record = invoke(prompt, key, HERE / 'budget.jsonl', args.cap_usd,
                                output['fresh_usd'], args.ledger, args.tag)
                record.update(run=args.tag, case=case['id'], phase=args.phase, runtime=versions)
                append(HERE / 'calls.jsonl', record)
                output['fresh_usd'] += record['charged_usd']
                cache[key] = record
            parsed = bridge('parse', rows=[{'request': prompt['request'], 'raw': record.get('result', '')}])[0]
            prediction = {'pass': True, 'fail': False}.get(parsed['answer']['outcome']) if not record.get('error') else None
            output['rows'].append({'id': case['id'], 'truth': case['truth'], 'prediction': prediction,
                                   'parsed': parsed, 'request_sha256': key, 'cost_usd': record['charged_usd'],
                                   **({'error': record['error']} if record.get('error') else {})})
            write(target, output)
            print(f"{args.tag}: {len(output['rows'])}/{len(cases)}; fresh USD {output['fresh_usd']:.6f}", flush=True)
            if record.get('cost_is_reservation') or record['charged_usd'] > RESERVE:
                raise ValueError('Unknown cost or exceeded per-call reservation; stopped')
        if source_hashes() != current:
            raise ValueError('Production inputs changed during final invocation')
        output['correct'] = sum(r['prediction'] is r['truth'] for r in output['rows'])
        output['inconclusive'] = sum(r['prediction'] is None for r in output['rows'])
        output['historical'] = historical_comparison(output['rows'], args.phase, output['sets_sha256'])
        output['complete'] = True
    except Exception as exc:
        output['stopped'] = str(exc)
        raise
    finally:
        write(target, output)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('phase', choices=['tuning', 'heldout', 'freeze'])
    ap.add_argument('--tag', default='tuning-current')
    ap.add_argument('--record', action='store_true')
    ap.add_argument('--cap-usd', type=float, default=0)
    ap.add_argument('--ledger', type=Path)
    ap.add_argument('--selected', type=Path)
    ap.add_argument('--criterion', type=Path, help='Tuning-only historical criterion snapshot')
    args = ap.parse_args()
    if args.criterion and args.phase != 'tuning':
        ap.error('Criterion override is tuning-only')
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', args.tag):
        ap.error('Tag must be a safe filename')
    if not math.isfinite(args.cap_usd) or not 0 <= args.cap_usd <= TOTAL_CAP:
        ap.error('Cap must be between zero and five USD')
    if args.record and (args.ledger is None or not args.ledger.is_absolute() or HERE in args.ledger.parents):
        ap.error('Paid calls require an absolute external --ledger path')
    if args.ledger and args.record:
        args.ledger.parent.mkdir(parents=True, exist_ok=True)
        args.ledger.touch(exist_ok=True)
    with (HERE / '.run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.phase == 'freeze':
            if args.selected is None:
                ap.error('Freeze requires --selected tuning report')
            freeze(HERE, args.selected)
            print('Candidate frozen; tuning is now prohibited.')
        else:
            evaluate(args)


if __name__ == '__main__':
    main()
