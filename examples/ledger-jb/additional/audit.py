"""Read-only independent checks; writes only each additional cell's audit artifact."""
import hashlib
import argparse
import json
import math
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]

def read(path):
    return json.loads(path.read_text())

def rows(path):
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def correct(games, label):
    return int(sum(1 if g == label else -1 if g in ('A', 'B') else 0 for g in games) > 0)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--model', choices=('claude-sonnet-5-5', 'gpt-6.1-sol'), action='append')
models = parser.parse_args().model or ('claude-sonnet-5-5', 'gpt-6.1-sol')

for model in models:
    cell = ROOT / 'cells' / model
    freeze = read(cell / 'freeze.json')
    report = read(cell / 'report.json')
    assert digest(ROOT / 'data/seal.json') == freeze['sealSha256']
    assert digest(ROOT / 'data/pool.json') == freeze['poolSha256']
    for path, expected in freeze['hashes'].items():
        assert digest(REPO / path) == expected, path
    checkpoint_receipts = subprocess.check_output(
        ['git', 'show', f'045dde5e7:examples/ledger-jb/cells/{model}/calls.jsonl'],
        cwd=REPO, stderr=subprocess.STDOUT)
    assert (cell / 'calls.jsonl').read_bytes().startswith(checkpoint_receipts), 'Checkpoint receipts or holds changed'
    calls = rows(cell / 'calls.jsonl')
    starts, finishes, active = {}, {}, set()
    max_active = 0
    recovery_max_active = 0
    for row in calls:
        key = row['key']
        assert row['model'] == model
        if row.get('modelActual'):
            assert row['modelActual'] == model
        if row['type'] == 'start':
            assert key not in starts
            starts[key] = row
            active.add(key)
            max_active = max(max_active, len(active))
            if row.get('recoveryAmendment'):
                recovery_max_active = max(recovery_max_active, len(active))
                assert len(active) <= 2
            liability = sum(finishes[k]['costUsd'] if k in finishes else s['reserveUsd'] for k, s in starts.items())
            assert liability <= freeze['capUsd'] + 1e-8
        else:
            assert key in starts and key not in finishes
            finishes[key] = row
            active.remove(key)
            assert row['costUsd'] <= starts[key]['reserveUsd'] + 1e-9
            assert (row.get('usage') or {}).get('output', 0) <= 8192
            if ':transport:' in key:
                base, attempt = key.rsplit(':transport:', 1)
                previous = base if int(attempt) == 2 else f'{base}:transport:{int(attempt)-1}'
                assert finishes[previous].get('transportFailure')
                assert not finishes[previous].get('returnedAnswer')
                assert not finishes[previous].get('text')
    assert max_active <= (8 if model == 'gpt-6.1-sol' else 4)
    assert not active, 'Audit requires settled calls'
    health = rows(cell / 'network-health.jsonl')
    controls = [x for x in health if x['status'] in ('health-gate-passed', 'network-paused')]
    for start in starts.values():
        if not start.get('recoveryAmendment'):
            continue
        preceding = [x for x in controls if x['at'] <= start['at']]
        assert preceding and preceding[-1]['status'] == 'health-gate-passed'
    for index, event in enumerate(health):
        if event['status'] != 'health-gate-passed':
            continue
        probes = [x for x in health[:index] if x['status'] == 'health-probe'][-10:]
        assert len(probes) == 10 and all(x['healthy'] for x in probes)
        times = [datetime.fromisoformat(x['at'].replace('Z', '+00:00')).timestamp() - x['elapsedMs']/1000 for x in probes]
        assert all(b-a >= 29.9 for a,b in zip(times,times[1:]))
    if model == 'gpt-6.1-sol':
        for row in finishes.values():
            if row.get('recoveryAmendment') and row.get('transportFailure'):
                receipt = json.loads(row['rawProvider'])
                assert all(key in receipt for key in ('networkCause', 'providerBody', 'bodyComplete', 'requestId', 'responseId'))
    pool = read(ROOT / 'data/pool.json')
    test = rows(cell / 'decisions-test.jsonl')
    assert len(test) == len({x['key'] for x in test})
    ledger = {x['itemId']: x for x in test if x['contestant'] == 'ledger'}
    peer = {x['itemId']: x for x in test if x['contestant'] == 'promptfoo'}
    matched = [x for x in pool if x['id'] in ledger and x['id'] in peer]
    assert len(matched) == len(pool) == 270
    assert len(test) == 540
    assert set(ledger) == set(peer) == {x['id'] for x in pool}
    logical = {}
    for row in finishes.values():
        base = row['key'].rsplit(':transport:', 1)[0]
        logical.setdefault(base, []).append(row)
    missing = [values for values in logical.values()
               if all(x.get('transportFailure') and not x.get('returnedAnswer') and not x.get('text') for x in values)]
    assert not missing, 'All practice and TEST transport requests must be settled'
    for values in logical.values():
        assert sum(not (x.get('transportFailure') and not x.get('returnedAnswer') and not x.get('text')) for x in values) <= 1
    if model == 'claude-sonnet-5-5':
        for row in finishes.values():
            if row['phase'] == 'test':
                assert row['billingRoute'] == 'cache-disabled'
                usage = row.get('usage') or {}
                assert usage.get('cached', 0) == usage.get('cacheWrite', 0) == 0
    a = b = wins = losses = 0
    for item in matched:
        x, y = correct(ledger[item['id']]['games'], item['label']), correct(peer[item['id']]['games'], item['label'])
        a += x
        b += y
        wins += x > y
        losses += x < y
    n = wins + losses
    p = min(1, 2 * sum(math.comb(n, k) for k in range(min(wins, losses) + 1)) / 2**n)
    assert report['n'] == len(matched)
    assert report['ledger']['correct'] == a and report['promptfoo']['correct'] == b
    assert report['wins'] == wins and report['losses'] == losses
    assert abs(report['p'] - p) < 1e-10
    known = sum(x['costUsd'] for x in finishes.values() if not x.get('costEstimated'))
    held = sum(x['costUsd'] for x in finishes.values() if x.get('costEstimated'))
    assert abs(report['budget']['measuredUsd'] - known) < 1e-8
    assert abs(report['budget']['holdsUsd'] - held) < 1e-8
    for contestant in ('ledger', 'promptfoo'):
        paid = [x for x in finishes.values() if x['contestant'] == contestant and x['phase'] == 'test']
        assert abs(sum(x['costUsd'] for x in paid) - report['cost'][contestant]['testUsd']) < 1e-8
    # Preserve prior answers and completed scores, allowing only the owner drop metadata.
    old_files = ['examples/ledger-jb/freeze.json', 'examples/ledger-jb/results/calls.jsonl']
    for path in old_files:
        original = subprocess.check_output(['git', 'show', f'ed441207:{path}'], cwd=REPO, stderr=subprocess.STDOUT)
        assert hashlib.sha256(original).hexdigest() == digest(REPO / path), path
    drop = read(ROOT / 'results/gemini-3.8-owner-drop.json')
    for path, expected in drop['preservedRecordings'].items():
        assert digest(REPO / path) == expected
    for path, expected in drop['files'].items():
        assert digest(REPO / path) == expected['afterSha256']
        original = subprocess.check_output(['git', 'show', f'ed441207:{path}'], cwd=REPO, stderr=subprocess.STDOUT)
        assert hashlib.sha256(original).hexdigest() == expected['beforeSha256']
    before = json.loads(subprocess.check_output(['git', 'show', 'ed441207:examples/ledger-jb/results/cells.json'], cwd=REPO, stderr=subprocess.STDOUT))
    after = read(ROOT / 'results/cells.json')
    assert {k:v for k,v in before.items() if k != 'cells'} == {k:v for k,v in after.items() if k != 'cells'}
    assert [x for x in before['cells'] if x['model'] != drop['model']] == [x for x in after['cells'] if x['model'] != drop['model']]
    original_cell = next(x for x in before['cells'] if x['model'] == drop['model'])
    assert read(ROOT / 'results/gemini-3.8-dropped/partial-cell-before.json')['historicalPartialData'] == original_cell
    dropped_cell = next(x for x in after['cells'] if x['model'] == drop['model'])
    assert dropped_cell['status'] == drop['status'] and dropped_cell['pendingWork'] is False
    assert dropped_cell['scoreReported'] is False and dropped_cell['p'] is None
    assert dropped_cell['ledger'] is None and dropped_cell['promptfoo'] is None
    driver = read(ROOT / 'results/driver-state.json')
    assert driver['models'][drop['model']]['status'] == 'dropped-by-owner'
    assert drop['model'] not in driver['pausedModels']
    result = {'model': model, 'matched': len(matched), 'ledgerCorrect': a, 'promptfooCorrect': b,
              'wins': wins, 'losses': losses, 'exactMcNemarP': p, 'starts': len(starts), 'finishes': len(finishes),
              'active': len(active), 'maximumActive': max_active, 'maximumRecoveryActive': recovery_max_active,
              'transportMissingTestRequests': 0, 'knownUsd': known, 'holdsUsd': held,
              'answeredTransportRetries': 0, 'outputAbove8192': 0, 'existingCompletedCellsUnchanged': True,
              'existingAnswersUnchanged': True, 'ownerDropApplied': True,
              'checkpointReceiptsAndHoldsPreserved': True,
              'freezeSha256': digest(cell / 'freeze.json'), 'callsSha256': digest(cell / 'calls.jsonl'),
              'reportSha256': digest(cell / 'report.json'),
              'sonnetTestCachingOff': model == 'claude-sonnet-5-5'}
    (cell / 'independent-audit.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
