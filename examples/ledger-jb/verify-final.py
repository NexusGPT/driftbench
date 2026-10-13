#!/usr/bin/env python3
"""Independent result and receipt checks. Never invokes a model."""
from pathlib import Path
from datetime import datetime, timezone
import json
import math
import hashlib

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
audit = load(results / 'receipt-audit.json')
assert audit['liabilityUsd'] <= 25 and audit['unresolvedCalls'] == 0
assert audit['allExpectedDecisionsComplete'] and audit['billingRejectionsStillMissing'] == 0
pool = load(root / 'data/pool.json')
cells = load(results / 'cells.json')['cells']
verified = []
for model in ['gpt-6-luna', 'claude-haiku-5-5', 'gemini-3.8-flash']:
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
          'unresolvedCalls': 0, 'liabilityUsd': audit['liabilityUsd'], 'cells': verified,
          'method': 'Independent Python integer binomial sum and official net score reconstructed from every sealed pair decision.'}
(results / 'final-independent-audit.json').write_text(json.dumps(output, indent=2) + '\n')
print(json.dumps(output, indent=2))
