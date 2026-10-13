"""Six continuous workers for the unchanged sealed map cohort, authorized by owner."""
import argparse
import concurrent.futures
import datetime
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CUTOFF = datetime.datetime.fromisoformat('2026-10-13T06:35:00+02:00')
CAP = 20.0

def validate():
    path = 'comparisons/astra-hard/stream-registration.json'
    manifest = json.loads((ROOT / path).read_text())
    commit = subprocess.check_output(['git', 'log', '-1', '--format=%H', '--', path], cwd=ROOT, text=True).strip()
    assert commit
    for name, digest in manifest['sha256'].items():
        value = (ROOT / name).read_bytes()
        assert hashlib.sha256(value).hexdigest() == digest
        assert subprocess.check_output(['git', 'show', f'{commit}:{name}'], cwd=ROOT) == value
    assert subprocess.check_output(['git', 'show', f'{commit}:{path}'], cwd=ROOT) == (ROOT / path).read_bytes()
    return commit

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ledger', type=Path, required=True)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    amendment = validate()
    spec = importlib.util.spec_from_file_location('frozen_map_runner', HERE / 'map/run.py')
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    registration = runner.validate_freeze()
    prompts = json.loads((HERE / 'map/all-prompts.json').read_text())
    assert len(prompts) == len({p['request_sha256'] for p in prompts}) == 1008
    if not args.execute:
        print('Free preflight: 1008 unchanged sealed requests, six continuous workers, last dispatch before06:35, USD20 shared cap.')
        return
    earlier = [json.loads(line) for path in [HERE / 'calls.jsonl', HERE / 'candidates/calls.jsonl'] for line in path.read_text().splitlines()]
    assert len(earlier) == 1152 and all(r['success'] and r['cost_known'] for r in earlier)
    runtime = HERE / 'map/runtime'
    runtime.mkdir(exist_ok=True)
    lock = (runtime / 'runner.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    calls = HERE / 'map/calls.jsonl'
    starts = HERE / 'map/starts.jsonl'
    assert not calls.exists() and not starts.exists(), 'This registration permits one fresh run only'
    spent = sum(r['cost_usd'] for r in earlier)
    records = []
    failed = False

    def ledger(row, side, note):
        selected = [r for r in records if r['row'] == row and r['side'] == side]
        cost = sum(r['cost_usd'] for r in selected)
        line = f'| {runner.stamp()} | astra-hard map replication {row} {side}: {note} | haiku | {len(selected)} fresh calls | task cap20.00 | {cost:.8f} USD | lane {spent:.8f} of20.00 USD |\n'
        with args.ledger.open('a') as file:
            fcntl.flock(file, fcntl.LOCK_EX)
            file.write(line)
            file.flush()

    def invoke(prompt):
        assert datetime.datetime.now(datetime.timezone.utc) < CUTOFF
        record = runner.invoke(prompt, registration, runtime)
        record['operational_amendment_commit'] = amendment
        return record

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for row in ['promptfoo-rubric', 'langfuse-reference']:
            pending = [p for p in prompts if p['row'] == row]
            for side in ['ours', 'peer', 'candidate']:
                ledger(row, side, 'start; unchanged sealed cases; six continuous workers; no retries')
            index = 0
            active = {}
            while index < len(pending) or active:
                while index < len(pending) and len(active) < 6 and not failed:
                    if datetime.datetime.now(datetime.timezone.utc) >= CUTOFF or spent + .03 * (len(active) + 1) > CAP:
                        failed = True
                        break
                    prompt = pending[index]
                    runner.append(starts, {'request_sha256': prompt['request_sha256'], 'started': runner.stamp(), 'row': row, 'id': prompt['id'], 'side': prompt['side'], 'reserved_usd': .03, 'operational_amendment_commit': amendment})
                    active[pool.submit(invoke, prompt)] = prompt
                    index += 1
                if not active:
                    break
                done, _ = concurrent.futures.wait(active, return_when=concurrent.futures.FIRST_COMPLETED)
                for future in done:
                    active.pop(future)
                    record = future.result()
                    runner.append(calls, record)
                    records.append(record)
                    spent += record['cost_usd']
                    failed = failed or not record['success']
                    if len(records) % 30 == 0:
                        print(f'{runner.stamp()} map {len(records)}/1008 calls; shared USD {spent:.8f}', flush=True)
            for side in ['ours', 'peer', 'candidate']:
                ledger(row, side, 'complete' if not failed else 'stopped; retain all recorded calls; no retries')
            if failed:
                break
    lock.close()
    assert not failed and len(records) == 1008, 'Stopped before completion; retain records, never retry'
    print(json.dumps({'map_calls': len(records), 'all_runs_cost_usd': spent, 'registration': registration, 'operational_amendment': amendment}), flush=True)

if __name__ == '__main__':
    main()
