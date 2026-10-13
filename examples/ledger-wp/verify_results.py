"""Verify source, pool, accounting and recording completeness offline."""
import collections
import datetime
import hashlib
import json
import model_cells
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
    if set(changed) != {'examples/ledger-wp/harness.ts', 'examples/ledger-wp/phase_report.py', 'examples/ledger-wp/stats.py'}:
        failures.append('Unexpected source change since initial freeze')
    if any(initial[field] != freeze[field] for field in ['seals', 'models', 'reasoning']):
        failures.append('Pool, model or reasoning changed')
    for cell in freeze.get('additionalModelCells', {}).values():
        for file, expected in cell.get('runtimeArtifactHashes', {}).items():
            if hashlib.sha256((ROOT / file).read_bytes()).hexdigest() != expected:
                failures.append('Additive runtime hash: ' + file)
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
    successful_keys = collections.Counter(r.get('logicalKey', r['key']) for r in calls if not r.get('providerError'))
    if any(count > 1 for count in successful_keys.values()):
        failures.append('An answered logical call was resubmitted')
    resume = freeze.get('geminiResumeAmendment', {})
    gemini_resumed = sorted([r for r in calls if r['model'] == 'gemini-3.8-flash'
                            and resume and r['startedAt'] >= resume['at']], key=lambda r: r['startedAt'])
    probe_verified = None
    if gemini_resumed:
        first_answer = next((r for r in gemini_resumed if not r.get('providerError')), None)
        probe_key = gemini_resumed[0].get('logicalKey', gemini_resumed[0]['key'])
        probe_verified = all(r.get('logicalKey', r['key']) == probe_key or
                             (first_answer is not None and r['startedAt'] >= first_answer['finishedAt'])
                             for r in gemini_resumed)
        if not probe_verified: failures.append('Gemini queue opened before the probe answered')
    job_key = lambda r: (r['split'], r['model'], r['contestant'], r['id'], r.get('sample', 0))
    if len({job_key(r) for r in decisions}) != len(decisions):
        failures.append('Duplicate decision keys')
    by_job = collections.defaultdict(list)
    for row in calls:
        by_job[job_key(row)].append(row)
        if not row.get('providerError') and (row['key'] not in settled or not math.isclose(settled[row['key']], row['costUsd'], abs_tol=1e-12)):
            failures.append('Returned cost not settled: ' + row['key'])
        if row.get('providerError') and row.get('costUsd', 0) > 0 and not math.isclose(settled.get('known-error-charge:' + row['key'], -1), row['costUsd'], abs_tol=1e-12):
            failures.append('Known no-answer charge not counted: ' + row['key'])
    for model, config in freeze.get('additionalModelCells', {}).items():
        cell_pending = {}; cell_actual = 0
        for event in read_rows(Path(config['spendFile']).name):
            if event['kind'] == 'reserve': cell_pending[event['key']] = event['usd']
            if event['kind'] == 'settle':
                cell_actual += event['usd']; cell_pending.pop(event['key'], None)
            if event['kind'] == 'release': cell_pending.pop(event['key'], None)
        if cell_actual + sum(cell_pending.values()) > config['capUsd']:
            failures.append('Additive model cap exceeded: ' + model)
        model_calls = [r for r in calls if r['model'] == model]
        if not math.isclose(cell_actual, sum(r['costUsd'] for r in model_calls), abs_tol=1e-10):
            failures.append('Additive model spend mismatch: ' + model)
        if any(not r.get('providerError') and r.get('providerMeta', {}).get('appliedThinkingLevel') != config['reasoning'] for r in model_calls):
            failures.append('Additive reasoning mismatch: ' + model)
    hold = freeze.get('geminiOwnerHold', {})
    if hold.get('active') and any(r['model'] == 'gemini-3.8-flash' and r['startedAt'] >= hold['at'] for r in calls):
        failures.append('Gemini 3.8 submitted during owner-only hold')
    coverage = []
    for split, items in seals.items():
        ids = {r['id'] for r in items}
        repeats = 3 if split in {'dev', 'fixtures'} else 1
        for model in model_cells.models():
            if split not in model_cells.phases(model): continue
            for contestant in model_cells.contestants(model):
                observed = [r for r in decisions if r['split'] == split and r['model'] == model and r['contestant'] == contestant]
                for row in observed:
                    if row['id'] not in ids or row['sample'] not in range(repeats) or len(row['games']) != 2:
                        failures.append('Unexpected decision: ' + str(job_key(row)))
                    if not math.isclose(row['costUsd'], sum(c['costUsd'] for c in by_job[job_key(row)] if not c.get('providerError')), abs_tol=1e-10):
                        failures.append('Decision cost mismatch: ' + str(job_key(row)))
                coverage.append({'split': split, 'model': model, 'contestant': contestant,
                                 'recorded': len(observed), 'expected': len(items) * repeats})
    required_models = sys.argv[sys.argv.index('--models')+1].split(',') if '--models' in sys.argv else model_cells.models()
    complete = all(r['recorded'] == r['expected'] for r in coverage if r['model'] in required_models)
    if '--require-complete' in sys.argv and not complete: failures.append('Incomplete phase coverage')
    output = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'failures': failures,
              'complete': complete, 'modelsChecked': required_models, 'sourceHashes': len(freeze['files']), 'sealHashes': len(seals),
              'actualUsd': actual, 'uncertainOrInflightUsd': sum(pending.values()), 'capUsd': freeze['capUsd'],
              'duplicateSuccessfulLogicalCalls': sum(count-1 for count in successful_keys.values()),
              'geminiSingleProbeVerified': probe_verified,
              'returnedCalls': len(calls), 'completedDecisions': len(decisions), 'coverage': coverage}
    (HERE / 'results/verification.json').write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({k: v for k, v in output.items() if k != 'coverage'}))
    if failures: raise SystemExit(1)


if __name__ == '__main__': main()
