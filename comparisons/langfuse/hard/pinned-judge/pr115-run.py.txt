"""Once per frozen case, serial Haiku, one USD round cap; replay is always free."""
import argparse
import datetime
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
from zoneinfo import ZoneInfo
from run import key, parse, wilson

ROOT = Path(__file__).resolve().parent
COMMIT = '8195902dd20c84267f85feba268c17868e00dfbe'

def validate_freeze():
    freeze = json.loads((ROOT / 'pr115-manifest.json').read_text())
    for name, expected in freeze['sha256'].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
            raise RuntimeError(f'frozen input changed: {name}')
    if freeze['judge_commit'] != COMMIT:
        raise RuntimeError('wrong judge commit')
    for name, expected in freeze['native_sha256'].items():
        if hashlib.sha256((ROOT.parents[2] / name).read_bytes()).hexdigest() != expected:
            raise RuntimeError(f'pinned judge source changed: {name}')
    return freeze

def permit_call(spent, initial, cap, now, deadline):
    if now >= deadline:
        raise RuntimeError('authorized deadline reached')
    if spent + .03 > 1 or spent - initial + .03 > cap:
        raise RuntimeError('round or invocation budget reached')

def replay(prompts, records):
    inputs = []
    for prompt in prompts:
        row = records.get(key(prompt['system'], prompt['user']))
        if row is None:
            continue
        for repair in [False, True]:
            inputs.append({'request': prompt['request'], 'raw': row['result'], 'value': parse(row['result'], repair)})
    if not inputs:
        return []
    native = subprocess.run(['node', '--import', 'tsx', str(ROOT / 'pr115.mts'), 'score'], input=json.dumps(inputs), capture_output=True, text=True, cwd=ROOT.parents[2], check=True)
    return json.loads(native.stdout)

def main():
    cli = argparse.ArgumentParser()
    cli.add_argument('--cap-usd', type=float, default=0)
    cli.add_argument('--limit', type=int, default=240)
    cli.add_argument('--ledger', type=Path)
    args = cli.parse_args()
    if not 0 <= args.cap_usd <= 1 or not 1 <= args.limit <= 240:
        raise SystemExit('cap must be zero to one USD; limit one to 240')
    freeze = validate_freeze()
    if args.cap_usd and subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() != COMMIT:
        raise SystemExit('paid runs require the exact approved judge commit')
    uncertain = ROOT / 'runtime' / 'pr115-unknown-billing.json'
    if uncertain.exists() and args.cap_usd:
        raise SystemExit('prior request has unknown billing; no retries are allowed')
    lock = (ROOT / 'pr115.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    path = ROOT / 'pr115-calls.jsonl'
    rows = [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
    records = {row['request_sha256']: row for row in rows}
    if len(records) != len(rows):
        raise SystemExit('duplicate recording; once per request is required')
    spent = sum(row['cost_usd'] for row in rows)
    initial = spent
    fresh = 0
    failure = None
    deadline = datetime.datetime.fromisoformat(freeze['deadline'])
    prompts = json.loads((ROOT / 'pr115-prompts.json').read_text())[:args.limit]
    runtime = ROOT / 'runtime'
    runtime.mkdir(exist_ok=True)

    def ledger(message):
        if args.ledger:
            with args.ledger.open('a') as file:
                stamp = datetime.datetime.now(ZoneInfo('Europe/Brussels')).strftime('%H:%M')
                file.write(f'| {stamp} | PR 115 default: {message} | haiku | {fresh} fresh | {args.cap_usd:.2f} run cap | {spent - initial:.8f} | round {spent:.8f} of 1.00 |\n')

    ledger('start; frozen 120 hard plus 120 held-out, serial, once each')
    try:
        for index, prompt in enumerate(prompts):
            digest = key(prompt['system'], prompt['user'])
            if digest not in records:
                call_cap = .03
                permit_call(spent, initial, args.cap_usd, datetime.datetime.now(datetime.timezone.utc), deadline)
                env = dict(os.environ)
                env.pop('CLAUDECODE', None)
                command = ['claude', '-p', '--output-format', 'json', '--model', 'haiku', '--system-prompt', prompt['system'], '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence', '--max-turns', '1', '--max-budget-usd', str(call_cap)]
                try:
                    completed = subprocess.run(command, input=prompt['user'], capture_output=True, text=True, cwd=runtime, env=env, timeout=180)
                    envelope = json.loads(completed.stdout)
                except (ValueError, subprocess.TimeoutExpired):
                    uncertain.write_text(json.dumps({'request_sha256': digest, 'billing': 'unknown', 'retry_allowed': False}) + '\n')
                    raise RuntimeError('missing completion envelope; stop because billing is unknown') from None
                cost = envelope.get('total_cost_usd')
                if not isinstance(cost, (int, float)) or isinstance(cost, bool) or not math.isfinite(cost) or cost < 0:
                    uncertain.write_text(json.dumps({'request_sha256': digest, 'billing': 'unknown', 'retry_allowed': False}) + '\n')
                    raise RuntimeError('missing cost; stop because billing is unknown')
                row = {'request_sha256': digest, 'set': prompt['set'], 'id': prompt['id'], 'judge_commit': COMMIT, 'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'model': 'haiku', 'system': prompt['system'], 'user': prompt['user'], 'result': envelope.get('result', ''), 'cost_usd': cost, 'usage': envelope.get('usage'), 'model_usage': envelope.get('modelUsage'), 'is_error': envelope.get('is_error', False), 'returncode': completed.returncode}
                with path.open('a') as file:
                    file.write(json.dumps(row, ensure_ascii=False) + '\n')
                    file.flush()
                    os.fsync(file.fileno())
                records[digest] = row
                spent += cost
                fresh += 1
            row = records[digest]
            if row['returncode'] or row['is_error']:
                raise RuntimeError('model error recorded; no retry or selective replacement')
            if (index + 1) % 10 == 0:
                print(index + 1, 'recorded; round USD', round(spent, 8), flush=True)
    except (RuntimeError, subprocess.TimeoutExpired) as error:
        failure = str(error)
    finally:
        ledger('finished' if failure is None else f'stopped: {failure}')
        lock.close()
    if failure:
        raise SystemExit(failure)
    native = iter(replay(prompts, records))
    results = []
    for prompt in prompts:
        row = records[key(prompt['system'], prompt['user'])]
        raw, repaired = next(native), next(native)
        case = next(c for c in json.loads((ROOT / prompt['set']).read_text()) if c['id'] == prompt['id'])
        results.append({'set': prompt['set'], 'id': prompt['id'], 'family': case['family'], 'label': case['label'], 'request_sha256': row['request_sha256'], 'prediction': 'unparsed' if repaired.get('unparsed') else repaired['answer']['outcome'], 'without_repair': 'unparsed' if raw.get('unparsed') else raw['answer']['outcome'], 'quote_repaired': bool(not parse(row['result'], False) and parse(row['result'])), 'cost_usd': row['cost_usd'], 'native_result': repaired})
    summary = {}
    for set_name in ['hard.json', 'heldout-cases.json']:
        subset = [row for row in results if row['set'] == set_name]
        if not subset:
            continue
        correct = sum(row['prediction'] == row['label'] for row in subset)
        cost = sum(row['cost_usd'] for row in subset)
        summary[set_name] = {'correct': correct, 'total': len(subset), 'ci95': wilson(correct, len(subset)), 'without_repair_correct': sum(row['without_repair'] == row['label'] for row in subset), 'quote_repaired': sum(row['quote_repaired'] for row in subset), 'unparsed': sum(row['prediction'] == 'unparsed' for row in subset), 'inconclusive': sum(row['prediction'] == 'inconclusive' for row in subset), 'evaluation_cost_usd': cost, 'usd_per_100': cost / len(subset) * 100}
    output = {'judge_commit': COMMIT, 'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'fresh_calls': fresh, 'fresh_cost_usd': spent - initial, 'round_cost_usd': spent, 'summary': summary, 'rows': results}
    (ROOT / 'pr115-scores.json').write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({k: v for k, v in output.items() if k != 'rows'}, indent=2), flush=True)

if __name__ == '__main__':
    main()
