#!/usr/bin/env python3
"""Release only owner-authorized outage holds after priced replacement answers settle."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true')
parser.add_argument('--spend-ledger', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent
r = root / 'results'
archive = r / 'outage-reconciliation'
manifest = json.loads((archive / 'manifest.json').read_text())
freeze = json.loads((root / 'freeze.json').read_text())
assert set(freeze['outageResumption']['noAnswerKeys']) == {x['key'] for x in manifest['receipts']}
path = r / 'calls.jsonl'
before = path.read_bytes()
rows = [json.loads(x) for x in before.splitlines()]
starts = {x['key'] for x in rows if x['type'] == 'start'}
finishes = {x['key']: x for x in rows if x['type'] == 'finish'}
assert starts == set(finishes), 'Drain active requests before reconciliation'
assert not (r / '.paid-run.lock').exists(), 'Paid writer still active'
assert not (archive / 'settlement.json').exists(), 'Outage settlement already recorded'
settled = []
unsettled = []
for original in manifest['receipts']:
    old = finishes[original['key']]
    assert old == original, 'Original outage receipt changed'
    replacement = finishes.get(original['key'] + ':transport:2')
    if (replacement and not replacement.get('transportFailure') and replacement.get('text')
            and not replacement.get('costEstimated') and replacement['costUsd'] >= 0):
        settled.append({'key': original['key'], 'replacementKey': replacement['key'], 'releasedUsd': old['costUsd']})
    else:
        unsettled.append(original['key'])
total = sum(x['releasedUsd'] for x in settled)
print(json.dumps({'settled': len(settled), 'unsettled': len(unsettled), 'releaseUsd': total}))
if not args.apply:
    raise SystemExit(0)
assert args.spend_ledger and args.spend_ledger.is_file(), 'Existing append-only spend ledger required'
keys = {x['key'] for x in settled}
for row in rows:
    if row['type'] == 'finish' and row['key'] in keys:
        row.update(costUsd=0, costEstimated=False, outageHoldReleased=True,
                   reconciliation='results/outage-reconciliation/settlement.json')
after = ('\n'.join(json.dumps(x, separators=(',', ':'), ensure_ascii=False) for x in rows) + '\n').encode()
at = datetime.now(timezone.utc).isoformat()
settlement = {'at': at, 'authorization': freeze['outageResumption']['authorization'],
              'sourceBeforeSha256': hashlib.sha256(before).hexdigest(),
              'sourceAfterSha256': hashlib.sha256(after).hexdigest(),
              'settled': settled, 'unsettled': unsettled, 'releasedUsd': total,
              'note': 'Owner-authorized release of unknown-cost outage holds after priced replacement answers. Not a provider refund.'}
path.write_bytes(after)
(archive / 'settlement.json').write_text(json.dumps(settlement, indent=2) + '\n')
with args.spend_ledger.open('a') as ledger:
    ledger.write(f'| {at} | ledger-jb authorized outage hold release | claude-haiku-5-5 | {len(settled)} settled replacements | {-total:.8f} USD reserved liability correction, not refund | evidence: examples/ledger-jb/results/outage-reconciliation/settlement.json |\n')
