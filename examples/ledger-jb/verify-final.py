#!/usr/bin/env python3
"""Independent result and receipt checks. Never invokes a model."""
from pathlib import Path
from datetime import datetime, timezone
import json
import math
import hashlib
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--available', action='store_true', help='Verify completed models while frozen paused models remain explicitly missing.')
args = parser.parse_args()

root = Path(__file__).resolve().parent
results = root / 'results'
load = lambda p: json.loads(p.read_text())
rows = lambda p: [json.loads(line) for line in p.read_text().splitlines()]
manifest = load(results / 'billing-reconciliation/manifest.json')
original = rows(results / 'billing-reconciliation/calls.jsonl')
current = rows(results / 'calls.jsonl')
assert hashlib.sha256((results / 'billing-reconciliation/calls.jsonl').read_bytes()).hexdigest() == manifest['sourceBeforeSha256']
lookup = {(row['type'], row['key']): row for row in current}
assert len(lookup) == len(current), 'Repeated call journal key'
released = {row['key'] for row in manifest['receipts']}
allowed = {'costUsd', 'costEstimated', 'graderError', 'billingResponse', 'billingRejected', 'retryable', 'reconciliation'}
for before in original:
    after = lookup[before['type'], before['key']]
    if before['type'] == 'finish' and before['key'] in released:
        assert before['status'] == 402 and 'prepayment credits are depleted' in before['error'].lower()
        assert {k: v for k, v in before.items() if k not in allowed} == {k: v for k, v in after.items() if k not in allowed}
        assert after['costUsd'] == 0 and not after['graderError'] and after['billingRejected']
    else:
        assert before == after, ('Unrelated historical receipt changed', before['key'])
outage = None
if (results / 'outage-reconciliation/manifest.json').exists():
    outage_manifest = load(results / 'outage-reconciliation/manifest.json')
    outage = load(results / 'outage-reconciliation/settlement.json')
    released_outage = {x['key'] for x in outage['settled']}
    allowed_outage = {'costUsd', 'costEstimated', 'outageHoldReleased', 'reconciliation'}
    for before in outage_manifest['receipts']:
        after = lookup['finish', before['key']]
        if before['key'] in released_outage:
            assert {k: v for k, v in before.items() if k not in allowed_outage} == {k: v for k, v in after.items() if k not in allowed_outage}
            assert after['costUsd'] == 0 and not after['costEstimated'] and after['outageHoldReleased']
            replacement = lookup['finish', before['key'] + ':transport:2']
            assert replacement.get('text') and not replacement.get('transportFailure') and not replacement.get('costEstimated')
        else:
            assert before == after
        assert sum(x['type'] == 'start' and x['key'].startswith(before['key'] + ':transport:') for x in current) == 1
audit = load(results / 'receipt-audit.json')
assert audit['liabilityUsd'] <= 25 and audit['unresolvedCalls'] == 0
assert audit['billingRejectionsStillMissing'] == 0
freeze = load(root / 'freeze.json')
models = ['gpt-6-luna', 'claude-haiku-5-5', 'gemini-3.8-flash']
pending = {}
if args.available:
    paused = freeze.get('pausedModels', {})
    assert paused, 'No frozen paused models to exclude'
    models = [m for m in models if m not in paused]
    for model, reason in paused.items():
        pending[model] = {'reason': reason, 'phases': {phase: {'decisions': data['decisions'], 'expectedDecisions': data['expectedDecisions']} for phase, data in audit['models'][model].items()}}
        assert not any(x['type'] == 'start' and x['model'] == model and x['at'] >= freeze['createdAt'] for x in current), 'Paused model received new requests'
else:
    assert audit['allExpectedDecisionsComplete']
pool = load(root / 'data/pool.json')
cells = load(results / 'cells.json')['cells']
verified = []
for model in models:
    assert all(p['complete'] for p in audit['models'][model].values()), ('Incomplete model', model)
    values = rows(results / f'decisions-test-{model}.jsonl')
    table = {x['id']: {} for x in pool}
    for x in values:
        assert x['contestant'] not in table[x['itemId']]
        table[x['itemId']][x['contestant']] = sum(1 if g == x['label'] else -1 if g in ['A', 'B'] else 0 for g in x['games']) > 0
    assert all(set(x) == {'ledger', 'promptfoo'} for x in table.values())
    wins = sum(x['ledger'] and not x['promptfoo'] for x in table.values())
    losses = sum(x['promptfoo'] and not x['ledger'] for x in table.values())
    p = min(1, 2 * sum(math.comb(wins + losses, i) for i in range(min(wins, losses) + 1)) / 2 ** (wins + losses))
    cell = next(c for c in cells if c['model'] == model)
    assert cell['n'] == len(table) and cell['wins'] == wins and cell['losses'] == losses and abs(cell['p'] - p) < 1e-12
    verified.append({'model': model, 'n': len(table), 'ledgerCorrect': sum(x['ledger'] for x in table.values()),
                     'promptfooCorrect': sum(x['promptfoo'] for x in table.values()), 'wins': wins, 'losses': losses,
                     'exactTwoSidedMcNemar': p})
output = {'at': datetime.now(timezone.utc).isoformat(), 'historicalReceiptsPreservedExceptAuthorized402Correction': True,
          'unresolvedCalls': 0, 'liabilityUsd': audit['liabilityUsd'], 'cells': verified, 'pending': pending,
          'outageHoldsReleasedUsd': outage['releasedUsd'] if outage else 0,
          'method': 'Independent Python integer binomial sum and official net score reconstructed from every sealed pair decision.'}
(results / ('available-independent-audit.json' if args.available else 'final-independent-audit.json')).write_text(json.dumps(output, indent=2) + '\n')
print(json.dumps(output, indent=2))
