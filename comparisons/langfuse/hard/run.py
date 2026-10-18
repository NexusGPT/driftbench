"""Serial Haiku measurements, append-only recordings, cumulative cap and free replay."""
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

ROOT = Path(__file__).resolve().parent

def parse(text, repair=True):
    text = text.strip().removeprefix('```json').removeprefix('```').removesuffix('```').strip()
    if text.startswith('['):
        return {}
    # Match the package contract: the final top-level JSON object wins.
    depth = 0
    start = 0
    in_string = False
    escaped = False
    last = None
    for index, char in enumerate(text):
        if depth == 0:
            if char == '{':
                depth = 1
                start = index
                in_string = escaped = False
            continue
        if in_string:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0:
                last = text[start:index + 1]
    if depth or last is None:
        return {}
    try:
        value = json.loads(last)
        return value if isinstance(value, dict) else {}
    except (ValueError, TypeError):
        if not repair:
            return {}
        try:
            value = json.loads(repair_quotes(last))
            return value if isinstance(value, dict) else {}
        except (ValueError, TypeError):
            return {}

def repair_quotes(text):
    # Same strict repair as packages/judges/src/contract.ts: only quotes inside strings.
    out = []
    in_string = escaped = False
    for index, char in enumerate(text):
        if not in_string:
            if char == '"':
                in_string = True
            out.append(char)
            continue
        if escaped:
            escaped = False
        elif char == '\\':
            escaped = True
        elif char == '"':
            following = text[index + 1:].lstrip()[:1]
            if not following or following in ',}]:':
                in_string = False
            else:
                out.append('\\')
        out.append(char)
    return ''.join(out)

def wilson(correct, count):
    z = 1.959963984540054
    p = correct / count
    denominator = 1 + z * z / count
    center = (p + z * z / (2 * count)) / denominator
    radius = z * math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / denominator
    return [center - radius, center + radius]

def key(system, user):
    return hashlib.sha256(json.dumps(['haiku', system, user], ensure_ascii=False).encode()).hexdigest()

def score(side, response, threshold, repair=True):
    parsed = parse(response, repair)
    if side == 'ours-audit':
        facts = parsed.get('facts')
        unsupported = parsed.get('unsupported')
        if not isinstance(facts, list) or not facts or not isinstance(unsupported, list):
            return 'unparsed'
        if any(not isinstance(x, str) or not x.strip() for x in unsupported):
            return 'unparsed'
        seen = set()
        for fact in facts:
            if not isinstance(fact, dict) or set(fact) != {'reference', 'reply', 'status'}:
                return 'unparsed'
            if not isinstance(fact['reference'], str) or not fact['reference'].strip() or not isinstance(fact['reply'], str):
                return 'unparsed'
            normalized = fact['reference'].strip().casefold()
            if normalized in seen or fact['status'] not in ('match', 'wrong', 'missing'):
                return 'unparsed'
            seen.add(normalized)
        return 'pass' if all(f['status'] == 'match' for f in facts) and not unsupported else 'fail'
    if side.startswith('ours'):
        return parsed.get('outcome', 'unparsed')
    value = parsed.get('score')
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 1:
        return 'pass' if value >= threshold else 'fail'
    return 'unparsed'

def main():
    cli = argparse.ArgumentParser()
    cli.add_argument('tag')
    cli.add_argument('--set', choices=['hard.json', 'heldout-cases.json'], default='hard.json')
    cli.add_argument('--sides', default='ours,theirs')
    cli.add_argument('--cap-usd', type=float, default=0)
    cli.add_argument('--ledger', type=Path)
    cli.add_argument('--limit', type=int, default=120)
    args = cli.parse_args()
    if f'{args.tag}.json' in ('hard.json', 'heldout-cases.json', 'manifest.json', 'prompts.json', 'heldout-prompts.json', 'experiment.json', 'scores.json'):
        raise SystemExit('result tag conflicts with a frozen input or metadata file')
    if not 1 <= args.limit <= 120 or not args.sides or any(s not in ('ours', 'theirs', 'ours-audit') for s in args.sides.split(',')):
        raise SystemExit('choose 1 to 120 cases and a known side')
    if args.cap_usd < 0 or args.cap_usd > 8:
        raise SystemExit('cap must be between zero and the authorized 8 USD')
    manifest = ROOT / 'manifest.json'
    if manifest.exists():
        expected = json.loads(manifest.read_text())['sha256'][args.set]
        actual = hashlib.sha256((ROOT / args.set).read_bytes()).hexdigest()
        if actual != expected:
            raise SystemExit('hard set changed; do not measure or replay a different set')
    lock = (ROOT / 'runner.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    recorded = ROOT / 'calls.jsonl'
    cache = {}
    spent = 0.0
    if recorded.exists():
        for line in recorded.read_text().splitlines():
            row = json.loads(line)
            cache[row['request_sha256']] = row
            spent += row['cost_usd']
    initial = spent
    fresh = 0
    prompt_name = 'prompts.json' if args.set == 'hard.json' else 'heldout-prompts.json'
    prompts = {r['id']: r for r in json.loads((ROOT / prompt_name).read_text())}
    cases = json.loads((ROOT / args.set).read_text())[:args.limit]
    runtime = ROOT / 'runtime'
    runtime.mkdir(exist_ok=True)
    experiment = ROOT / 'experiment.json'
    if experiment.exists():
        deadline = datetime.datetime.fromisoformat(json.loads(experiment.read_text())['deadline'])
    else:
        now = datetime.datetime.now(ZoneInfo('Europe/Brussels'))
        deadline = now.replace(hour=7, minute=0, second=0, microsecond=0)
        if deadline <= now:
            deadline += datetime.timedelta(days=1)
        experiment.write_text(json.dumps({'started': now.isoformat(), 'deadline': deadline.isoformat(), 'budget_usd': 8}, indent=2) + '\n')
    def ledger(text):
        if args.ledger:
            with args.ledger.open('a') as file:
                stamp = datetime.datetime.now(ZoneInfo('Europe/Brussels')).strftime('%H:%M')
                file.write(f'| {stamp} | hard evaluator {args.tag}: {text} | haiku | {fresh} fresh | {args.cap_usd:.2f} run cap | {spent - initial:.8f} | hard evaluator task {spent:.8f} of 8.00 |\n')
    if args.ledger:
        ledger('start; serial, fixed constructed cases, paid budget enforced' if args.cap_usd else 'start; free replay only')
    results = []
    failure = None
    try:
        for side in args.sides.split(','):
            for index, case in enumerate(cases):
                prompt = prompts[case['id']][side]
                k = key(**prompt)
                if k not in cache:
                    call_cap = 0.03
                    if datetime.datetime.now(ZoneInfo('Europe/Brussels')) >= deadline:
                        raise RuntimeError('07:00 local deadline reached')
                    if spent + call_cap > 8 or spent - initial + call_cap > args.cap_usd:
                        raise RuntimeError('budget reached; replay existing calls or raise invocation cap within 8 USD')
                    env = dict(os.environ)
                    env.pop('CLAUDECODE', None)
                    command = ['claude', '-p', '--output-format', 'json', '--model', 'haiku', '--system-prompt', prompt['system'], '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence', '--max-turns', '1', '--max-budget-usd', str(call_cap)]
                    completed = subprocess.run(command, input=prompt['user'], capture_output=True, text=True, cwd=runtime, env=env, timeout=180)
                    try:
                        envelope = json.loads(completed.stdout)
                    except ValueError:
                        # No completion envelope means billing cannot be measured. Stop, do not retry.
                        raise RuntimeError(f'no model envelope: {completed.stderr[:200]}') from None
                    cost = envelope.get('total_cost_usd')
                    if not isinstance(cost, (int, float)) or cost < 0:
                        raise RuntimeError('missing cost; stop because cumulative spend is unknown')
                    row = {'request_sha256': k, 'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'model': 'haiku', **prompt, 'result': envelope.get('result', ''), 'cost_usd': cost, 'usage': envelope.get('usage'), 'model_usage': envelope.get('modelUsage'), 'is_error': envelope.get('is_error', False), 'returncode': completed.returncode}
                    with recorded.open('a') as file:
                        file.write(json.dumps(row, ensure_ascii=False) + '\n')
                        file.flush()
                        os.fsync(file.fileno())
                    cache[k] = row
                    spent += cost
                    fresh += 1
                    if completed.returncode or row['is_error']:
                        raise RuntimeError(f'model error recorded for {case["id"]}; cost included')
                answer = cache[k]
                if answer['returncode'] or answer['is_error']:
                    raise RuntimeError(f'cached model error for {case["id"]}; not a usable judge answer')
                results.append({'side': side, 'id': case['id'], 'family': case['family'], 'label': case['label'], 'request_sha256': k, 'prediction': score(side, answer['result'], 1), 'prediction_at_half': score(side, answer['result'], .5), 'prediction_without_repair': score(side, answer['result'], 1, False), 'half_without_repair': score(side, answer['result'], .5, False), 'quote_repaired': bool(not parse(answer['result'], False) and parse(answer['result'])), 'cost_usd': answer['cost_usd']})
                if (index + 1) % 10 == 0:
                    print(side, index + 1, 'fresh', fresh, 'cumulative USD', round(spent, 6), flush=True)
    except (RuntimeError, subprocess.TimeoutExpired) as error:
        failure = str(error)
    finally:
        summary = {}
        for side in args.sides.split(','):
            subset = [r for r in results if r['side'] == side]
            if not subset:
                continue
            correct = sum(r['prediction'] == r['label'] for r in subset)
            summary[side] = {'correct': correct, 'total': len(subset), 'ci95': wilson(correct, len(subset)), 'at_half_correct': sum(r['prediction_at_half'] == r['label'] for r in subset), 'unparsed': sum(r['prediction'] == 'unparsed' for r in subset), 'without_repair_correct': sum(r['prediction_without_repair'] == r['label'] for r in subset), 'half_without_repair_correct': sum(r['half_without_repair'] == r['label'] for r in subset), 'quote_repaired': sum(r['quote_repaired'] for r in subset), 'evaluation_cost_usd': sum(r['cost_usd'] for r in subset)}
        output = {'tag': args.tag, 'set': args.set, 'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'threshold': 1, 'alternative_threshold': .5, 'fresh_calls': fresh, 'fresh_cost_usd': spent - initial, 'cumulative_cost_usd': spent, 'failure': failure, 'summary': summary, 'rows': results}
        (ROOT / f'{args.tag}.json').write_text(json.dumps(output, indent=2) + '\n')
        print(json.dumps({k: v for k, v in output.items() if k != 'rows'}, indent=2), flush=True)
        if args.ledger:
            ledger('finished' if failure is None else f'stopped: {failure}')
        lock.close()
    if failure:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
