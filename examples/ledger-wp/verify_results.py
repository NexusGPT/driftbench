"""Verify source, pool, accounting and recording completeness offline."""
import collections
import datetime
import hashlib
import json
import math
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def read_rows(name):
    file = HERE / 'results' / name
    return [json.loads(x) for x in file.read_text().splitlines() if x] if file.exists() else []


def main():
    freeze = json.loads((HERE / 'freeze.json').read_text())
    initial = json.loads((HERE / 'freeze-initial.json').read_text())
    failures = []
    for file, expected in freeze['files'].items():
        if hashlib.sha256((ROOT / file).read_bytes()).hexdigest() != expected:
            failures.append('Source hash: ' + file)
    changed = [file for file in freeze['files'] if initial['files'].get(file) != freeze['files'][file]]
    if changed != ['examples/ledger-wp/harness.ts']:
        failures.append('Unexpected source change since initial freeze')
    if any(initial[field] != freeze[field] for field in ['seals', 'models', 'reasoning']):
        failures.append('Pool, model or reasoning changed')
    seals = {}
    for split, expected in freeze['seals'].items():
        file = HERE / 'seals' / (split + '.json')
        if hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            failures.append('Seal hash: ' + split)
        seals[split] = json.loads(file.read_text())
    calls = read_rows('calls.jsonl')
    decisions = [r for r in read_rows('decisions.jsonl') if r['model'] != 'machine']
    pending = {}
    settled = {}
    for row in read_rows('spend.jsonl'):
        if row['kind'] == 'reserve': pending[row['key']] = row['usd']
        if row['kind'] == 'release': pending.pop(row['key'], None)
        if row['kind'] == 'settle':
            if row['key'] in settled: failures.append('Duplicate settlement: ' + row['key'])
            settled[row['key']] = row['usd']
            pending.pop(row['key'], None)
    actual = sum(settled.values())
    if actual + sum(pending.values()) > freeze['capUsd']:
        failures.append('Spend cap exceeded')
    if len({r['key'] for r in calls}) != len(calls):
        failures.append('Duplicate returned call keys')
    job_key = lambda r: (r['split'], r['model'], r['contestant'], r['id'], r.get('sample', 0))
    if len({job_key(r) for r in decisions}) != len(decisions):
        failures.append('Duplicate decision keys')
    by_job = collections.defaultdict(list)
    for row in calls:
        by_job[job_key(row)].append(row)
        if not row.get('providerError') and (row['key'] not in settled or not math.isclose(settled[row['key']], row['costUsd'], abs_tol=1e-12)):
            failures.append('Returned cost not settled: ' + row['key'])
    coverage = []
    for split, items in seals.items():
        ids = {r['id'] for r in items}
        repeats = 3 if split in {'dev', 'fixtures'} else 1
        for model in freeze['models']:
            for contestant in ['pair-ledger', 'reader-first-c50b2dc3', 'promptfoo']:
                observed = [r for r in decisions if r['split'] == split and r['model'] == model and r['contestant'] == contestant]
                for row in observed:
                    if row['id'] not in ids or row['sample'] not in range(repeats) or len(row['games']) != 2:
                        failures.append('Unexpected decision: ' + str(job_key(row)))
                    if not math.isclose(row['costUsd'], sum(c['costUsd'] for c in by_job[job_key(row)]), abs_tol=1e-10):
                        failures.append('Decision cost mismatch: ' + str(job_key(row)))
                coverage.append({'split': split, 'model': model, 'contestant': contestant,
                                 'recorded': len(observed), 'expected': len(items) * repeats})
    complete = all(r['recorded'] == r['expected'] for r in coverage)
    if '--require-complete' in sys.argv and not complete: failures.append('Incomplete phase coverage')
    output = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'failures': failures,
              'complete': complete, 'sourceHashes': len(freeze['files']), 'sealHashes': len(seals),
              'actualUsd': actual, 'uncertainOrInflightUsd': sum(pending.values()), 'capUsd': freeze['capUsd'],
              'returnedCalls': len(calls), 'completedDecisions': len(decisions), 'coverage': coverage}
    (HERE / 'results/verification.json').write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({k: v for k, v in output.items() if k != 'coverage'}))
    if failures: raise SystemExit(1)


if __name__ == '__main__': main()
