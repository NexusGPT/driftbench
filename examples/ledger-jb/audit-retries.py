#!/usr/bin/env python3
"""Distinguish automatic transport retries from explicitly authorized billing resumptions."""
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json

root = Path(__file__).resolve().parent
rows = [json.loads(line) for line in (root / 'results/calls.jsonl').read_text().splitlines()]
finishes = {x['key']: x for x in rows if x['type'] == 'finish'}
freeze = json.loads((root / 'freeze.json').read_text())
authorized = set(freeze.get('billingResumption', {}).get('rejectedKeys', []))
outage_authorized = set(freeze.get('outageResumption', {}).get('noAnswerKeys', []))
models = defaultdict(Counter)
for row in rows:
    if row['type'] != 'start' or row.get('transportAttempt', 1) <= 1:
        continue
    base = row['key'].rsplit(':transport:', 1)[0]
    previous_attempt = row['transportAttempt'] - 1
    previous_key = base if previous_attempt == 1 else f'{base}:transport:{previous_attempt}'
    previous = finishes[previous_key]
    assert previous.get('transportFailure') and not previous.get('returnedAnswer') and not previous.get('text'), ('Answered request reissued', row['key'])
    if previous_key in outage_authorized:
        assert row['transportAttempt'] == 2 and row['model'] == 'claude-haiku-5-5'
        kind = 'ownerAuthorizedOutageResumptions'
    elif previous.get('status') == 402:
        assert previous_key in authorized and previous.get('billingRejected')
        kind = 'ownerAuthorizedBillingResumptions'
    elif previous.get('status') == 429:
        kind = 'quotaRetries'
    else:
        assert previous.get('retryable'), ('Nonretryable response reissued', row['key'])
        kind = 'automaticNoAnswerTransportRetries'
    models[row['model']][kind] += 1
probe = json.loads((root / 'results/gemini-topup-probe.json').read_text())
assert sum(x['type'] == 'start' and x['key'] == probe['responseKey'] for x in rows) == 1
result = {'at': datetime.now(timezone.utc).isoformat(), 'models': {k: dict(v) for k, v in models.items()},
          'returnedAnswersResent': 0, 'topupProbeIssuedOnce': True,
          'scope': 'Journaled transport attempts only. The core schema re-ask remains a separate judge feature, reported in reask-counts.json.'}
(root / 'results/transport-recovery-audit.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
