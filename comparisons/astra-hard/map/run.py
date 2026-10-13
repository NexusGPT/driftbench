"""One fresh answer per request, two concurrent model calls, capped and journaled."""
import argparse
import concurrent.futures
import datetime
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
FLAGS = ['-p', '--output-format', 'json', '--model', 'haiku', '--tools', '',
         '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
         '--max-turns', '1', '--max-budget-usd', '0.03']
CALL_CAP = 0.03
TOTAL_CAP = 10.0
DEADLINE = datetime.datetime.fromisoformat('2026-10-13T07:30:00+02:00')


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def append(path, row):
    with path.open('a') as file:
        file.write(json.dumps(row, ensure_ascii=False) + '\n')
        file.flush()
        os.fsync(file.fileno())


def validate_freeze():
    manifest = json.loads((HERE / 'preregistration.json').read_text())
    for name, digest in manifest['sha256'].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest, f'Frozen file changed: {name}'
    # Verify that every input and the manifest are already present in a commit.
    names = list(manifest['sha256']) + ['comparisons/astra-hard/map/preregistration.json']
    commit = subprocess.check_output(['git', 'log', '-1', '--format=%H', '--', 'comparisons/astra-hard/map/preregistration.json'], cwd=ROOT, text=True).strip()
    assert commit, 'Pre-registration must be committed before paid calls'
    for name in names:
        committed = subprocess.check_output(['git', 'show', f'{commit}:{name}'], cwd=ROOT)
        assert committed == (ROOT / name).read_bytes(), f'Uncommitted input: {name}'
    return commit


def invoke(prompt, commit, runtime):
    started = stamp()
    env = dict(os.environ)
    env.pop('CLAUDECODE', None)
    record = {**prompt, 'started': started, 'preregistration_commit': commit, 'model_alias': 'haiku'}
    try:
        completed = subprocess.run(['claude', *FLAGS, '--system-prompt', prompt['system']],
            input=prompt['user'], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            cwd=runtime, env=env, timeout=180)
        envelope = json.loads(completed.stdout)
        cost = envelope.get('total_cost_usd')
        known = isinstance(cost, (int, float)) and not isinstance(cost, bool) and math.isfinite(cost) and cost >= 0
        success = completed.returncode == 0 and envelope.get('subtype') == 'success' and not envelope.get('is_error')
        record.update(result=envelope.get('result', ''), cost_usd=cost if known else CALL_CAP,
            cost_known=known, success=success and known, returncode=completed.returncode,
            usage=envelope.get('usage'), model_usage=envelope.get('modelUsage'),
            subtype=envelope.get('subtype'), is_error=envelope.get('is_error', False))
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        # No retry, no secret-bearing stderr or exception detail in the report.
        record.update(result='', cost_usd=CALL_CAP, cost_known=False, success=False,
            failure_type=type(error).__name__)
    record['finished'] = stamp()
    return record


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument('--ledger', type=Path, required=True)
    cli.add_argument('--execute', action='store_true')
    args = cli.parse_args()
    commit = validate_freeze()
    prompts = json.loads((HERE / 'all-prompts.json').read_text())
    assert len(prompts) == 1008 and len({p['request_sha256'] for p in prompts}) == 1008
    if not args.execute:
        print(f'Free preflight passed: {len(prompts)} committed requests at {commit}.')
        return
    runtime = HERE / 'runtime'
    runtime.mkdir(exist_ok=True)
    lock = (runtime / 'runner.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    calls = HERE / 'calls.jsonl'
    journal = HERE / 'starts.jsonl'
    prior = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
    starts = [json.loads(line) for line in journal.read_text().splitlines()] if journal.exists() else []
    records = {r['request_sha256']: r for r in prior}
    assert len(records) == len(prior), 'Duplicate answer'
    assert all(r['success'] for r in prior), 'Prior error forbids another attempt'
    assert {r['request_sha256'] for r in starts} == set(records), 'Unknown prior completion: do not retry'
    earlier = [json.loads(line) for f in [HERE.parent / 'calls.jsonl', HERE.parent / 'candidates/calls.jsonl'] for line in f.read_text().splitlines()]
    assert len(earlier) == 1152 and all(r['success'] for r in earlier), 'Finish primary and candidate runs first'
    spent = sum(r['cost_usd'] for r in prior) + sum(r['cost_usd'] for r in earlier)
    initial = spent
    fresh = []

    def ledger(row, side, note):
        subset = [r for r in fresh if r['row'] == row and r['side'] == side]
        cost = sum(r['cost_usd'] for r in subset)
        line = f'| {stamp()} | astra-hard map replication {row} {side}: {note} | haiku | {len(subset)} fresh calls | task cap 10.00 | {cost:.8f} USD | lane {spent:.8f} of 10.00 USD |\n'
        with args.ledger.open('a') as file:
            fcntl.flock(file, fcntl.LOCK_EX)
            file.write(line)
            file.flush()
            os.fsync(file.fileno())

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            for row in ['promptfoo-rubric', 'langfuse-reference']:
                for side in ['ours', 'peer', 'candidate']:
                    ledger(row, side, f'start; {sum(p["row"] == row and p["side"] == side for p in prompts)} sealed cases, global concurrency 2, no retries')
                pending = [p for p in prompts if p['row'] == row and p['request_sha256'] not in records]
                # Requests follow the frozen side and case order. At most two
                # in flight; all answers persist before the next pair starts.
                for offset in range(0, len(pending), 2):
                    batch = pending[offset:offset + 2]
                    assert spent + CALL_CAP * len(batch) <= TOTAL_CAP, 'Budget reserve reached'
                    assert datetime.datetime.now(datetime.timezone.utc) < DEADLINE, 'Deadline reached'
                    futures = []
                    for prompt in batch:
                        append(journal, {'request_sha256': prompt['request_sha256'], 'started': stamp(), 'row': row, 'id': prompt['id'], 'side': prompt['side'], 'reserved_usd': CALL_CAP})
                        futures.append(pool.submit(invoke, prompt, commit, runtime))
                    batch_records = []
                    for future in concurrent.futures.as_completed(futures):
                        record = future.result()
                        append(calls, record)
                        records[record['request_sha256']] = record
                        fresh.append(record)
                        spent += record['cost_usd']
                        batch_records.append(record)
                    assert all(r['success'] for r in batch_records), 'Recorded call failure; no retry'
                    if (offset + len(batch)) % 20 == 0:
                        print(f'{stamp()} {row}: {offset + len(batch)}/{len(pending)} requests; cumulative USD {spent:.8f}', flush=True)
                for side in ['ours', 'peer', 'candidate']:
                    ledger(row, side, 'complete')
    except BaseException:
        for row in ['promptfoo-rubric', 'langfuse-reference']:
            for side in ['ours', 'peer', 'candidate']:
                ledger(row, side, 'stopped; retain all recorded calls, no retries')
        raise
    finally:
        lock.close()
    print(json.dumps({'fresh_calls': len(fresh), 'fresh_cost_usd': spent - initial, 'total_cost_usd': spent, 'preregistration_commit': commit}), flush=True)


if __name__ == '__main__':
    main()
