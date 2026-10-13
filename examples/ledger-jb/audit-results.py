#!/usr/bin/env python3
"""Receipt and coverage audit. No calls, relabeling or verdict changes."""
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / 'results'
MODELS = ['gpt-6-luna', 'claude-haiku-5-5', 'gemini-3.8-flash']
PHASES = ['pilot', 'fixtures', 'noise', 'validity', 'test']


def read_rows(path):
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def read_json(path):
    return json.loads(path.read_text())


def correct(games, label):
    return int(sum(1 if game == label else -1 if game in ['A', 'B'] else 0 for game in games) > 0)


freeze = read_json(ROOT / 'freeze.json')
MODELS = list(freeze['models'])
calls = read_rows(RESULTS / 'calls.jsonl')
starts = {}; finishes = {}; active = set(); max_active = 0; max_current_active = 0
active_by_model = Counter(); max_current_by_model = Counter(); liability = 0; max_liability = 0
for row in calls:
    key = row['key']
    if row['type'] == 'start':
        assert key not in starts, ('duplicate_start', key)
        assert liability + row['reserveUsd'] <= 25 + 1e-8, ('budget_reservation', key)
        starts[key] = row; active.add(key); active_by_model[row['model']] += 1
        liability += row['reserveUsd']
        max_active = max(max_active, len(active))
        if row['at'] >= freeze['createdAt']:
            max_current_active = max(max_current_active, len(active))
            max_current_by_model[row['model']] = max(max_current_by_model[row['model']], active_by_model[row['model']])
    else:
        assert row['type'] == 'finish' and key in starts and key not in finishes, ('invalid_finish', key)
        assert row['costUsd'] >= 0, ('negative_cost', key)
        finishes[key] = row; active.remove(key); active_by_model[row['model']] -= 1
        liability += row['costUsd'] - starts[key]['reserveUsd']
        if row.get('status') == 429:
            assert row.get('quotaResponse') and not row.get('graderError'), ('quota_as_judge_failure', key)
        if row.get('status') == 402:
            assert row.get('billingResponse') and not row.get('graderError'), ('billing_as_judge_failure', key)
            if row.get('billingRejected'):
                assert row['costUsd'] == 0 and not row.get('costEstimated'), ('rejected_call_hold', key)
    max_liability = max(max_liability, liability)
assert max_current_active <= sum(freeze['modelConcurrency'].values())
model_liabilities = {model: sum(finishes.get(key, {}).get('costUsd', row['reserveUsd']) for key, row in starts.items() if row['model'] == model) for model in MODELS}
for model, cap in freeze.get('modelCapsUsd', {}).items():
    assert model_liabilities[model] <= cap + 1e-8, ('model_budget_exceeded', model)
for model, limit in freeze['modelConcurrency'].items():
    assert max_current_by_model[model] <= limit

unresolved_billing = []
for rejection in finishes.values():
    if rejection.get('status') != 402:
        continue
    resolved = any((not response.get('transportFailure') or response.get('returnedAnswer'))
                   and response.get('transportAttempt', 1) > rejection.get('transportAttempt', 1)
                   and all(response.get(k) == rejection.get(k) for k in ['phase', 'model', 'itemId', 'repeat', 'contestant', 'order', 'attempt'])
                   for response in finishes.values())
    if not resolved:
        unresolved_billing.append(rejection)

inputs = {phase: read_json(ROOT / 'data' / f"{'pool' if phase == 'test' else phase}.json") for phase in PHASES}
models = {}
for model in MODELS:
    phases = {}
    for phase in PHASES:
        rows = read_rows(RESULTS / f'decisions-{phase}-{model}.jsonl')
        repeats = range(3) if phase in ['fixtures', 'noise'] else range(1)
        contestants = ['ledger'] if phase in ['fixtures', 'validity'] else ['ledger', 'promptfoo']
        expected = {f"{phase}:{model}:{item['id']}:{repeat}:{contestant}" for item in inputs[phase] for repeat in repeats for contestant in contestants}
        keys = [row['key'] for row in rows]
        assert len(keys) == len(set(keys)), ('duplicate_decision', phase, model)
        assert set(keys) <= expected, ('unexpected_decision', phase, model)
        by_id = {item['id']: item for item in inputs[phase]}
        for row in rows:
            assert not any(x['key'].startswith(row['key'] + ':') for x in unresolved_billing), ('unresolved_billing_rejection_in_decision', row['key'])
            assert row['label'] == by_id[row['itemId']]['label'], ('label_mismatch', row['key'])
            assert len(row['games']) == 2 and all(game in ['A', 'B', 'tie', None] for game in row['games'])
        receipts = [x for x in finishes.values() if x['model'] == model and x['phase'] == phase]
        initiated = [x for x in starts.values() if x['model'] == model and x['phase'] == phase]
        reasks = [x for x in initiated if x.get('attempt') == 1 and x.get('transportAttempt', 1) == 1]
        reask_reasons = Counter()
        for reask in reasks:
            previous = [x for x in receipts if x.get('attempt') == 0 and all(x.get(k) == reask.get(k) for k in ['itemId', 'repeat', 'contestant', 'order'])]
            assert previous, ('reask_without_first_receipt', reask['key'])
            reask_reasons['returned_nonempty_text' if previous[-1].get('text') else 'missing_or_empty_text'] += 1
        cost = {}
        for contestant in contestants:
            subset = [x for x in receipts if x['contestant'] == contestant]
            decisions = [x for x in rows if x['contestant'] == contestant]
            known = sum(x['costUsd'] for x in subset if not x.get('costEstimated'))
            unknown = sum(x['costUsd'] for x in subset if x.get('costEstimated'))
            cost[contestant] = {'decisions': len(decisions), 'knownUsd': known, 'unknownReserveUsd': unknown,
                                 'knownPer100': known * 100 / len(decisions) if decisions else None,
                                 'upperPer100': (known + unknown) * 100 / len(decisions) if decisions else None}
        groups = {}
        if phase == 'test':
            for group in sorted({x['group'] for x in inputs[phase]}):
                groups[group] = {}
                for contestant in contestants:
                    subset = [x for x in rows if x['group'] == group and x['contestant'] == contestant]
                    groups[group][contestant] = {'n': len(subset), 'correct': sum(correct(x['games'], x['label']) for x in subset)}
        ledger = [x for x in rows if x['contestant'] == 'ledger']
        phases[phase] = {'decisions': len(rows), 'expectedDecisions': len(expected), 'complete': set(keys) == expected,
                         'callsStarted': len(initiated), 'callsFinished': len(receipts), 'schemaReasks': len(reasks),
                         'schemaReaskPreviousResponse': dict(reask_reasons),
                         'transportRetryAttempts': sum(x.get('transportAttempt', 1) > 1 for x in initiated),
                         'quotaResponses': sum(x.get('status') == 429 for x in receipts),
                         'billingRejections': sum(x.get('status') == 402 for x in receipts),
                         'decisionGraderErrors': sum(x.get('graderErrors', 0) for x in rows),
                         'transportSuppressedCoreReasks': sum(x.get('transportExhaustedReasksSuppressed', 0) for x in ledger),
                         'schemaReasksSuppressed': sum(x.get('suppressedReasks', 0) for x in ledger),
                         'ledgerPairs': len(ledger), 'ledgerPhysicalReads': sum(x.get('calls', 0) for x in ledger),
                         'ledgerMachinePairs': sum(x.get('calls', 0) == 0 for x in ledger),
                         'cost': cost, 'descriptiveGroups': groups}
    models[model] = phases

audit = {'asOf': datetime.now(timezone.utc).isoformat(), 'core': freeze['coreCommit'],
         'freezeSha256': hashlib.sha256((ROOT / 'freeze.json').read_bytes()).hexdigest(),
         'allExpectedDecisionsComplete': all(x['complete'] for m in models.values() for x in m.values()),
         'starts': len(starts), 'finishes': len(finishes), 'unresolvedCalls': len(active),
         'maximumHistoricalConcurrentCalls': max_active, 'maximumCurrentFreezeConcurrentCalls': max_current_active,
         'maximumCurrentFreezeConcurrentCallsByModel': dict(max_current_by_model),
         'knownUsd': sum(x['costUsd'] for x in finishes.values() if not x.get('costEstimated')),
         'unknownReserveUsd': sum(x['costUsd'] for x in finishes.values() if x.get('costEstimated')),
         'activeReserveUsd': sum(starts[key]['reserveUsd'] for key in active), 'liabilityUsd': liability,
         'billingRejectionsStillMissing': len(unresolved_billing),
         'maximumLiabilityUsd': max_liability, 'models': models,
         'modelLiabilityUsd': model_liabilities, 'modelCapsUsd': freeze.get('modelCapsUsd', {}),
         'scope': 'Postprocessing integrity audit. Descriptive group counts do not replace the registered endpoint.'}
(RESULTS / 'receipt-audit.json').write_text(json.dumps(audit, indent=2) + '\n')
print(json.dumps({k: v for k, v in audit.items() if k != 'models'}, indent=2))
