#!/usr/bin/env python3
"""One-time owner-authorized 402 correction; originals and every released hold are preserved."""
from pathlib import Path
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import sys

root = Path(__file__).resolve().parent
results = root / 'results'
archive = results / 'billing-reconciliation'
spend = Path(sys.argv[1])
assert not archive.exists(), 'Reconciliation is one-shot; inspect existing manifest before proceeding'
assert not (results / '.paid-run.lock').exists(), 'Paid runner must be stopped'
source = results / 'calls.jsonl'
rows = [json.loads(line) for line in source.read_text().splitlines()]
starts = {x['key']: x for x in rows if x['type'] == 'start'}
finishes = {x['key']: x for x in rows if x['type'] == 'finish'}
assert starts.keys() == finishes.keys(), 'Unresolved call cannot be released by this correction'
bad = [x for x in finishes.values() if x.get('status') == 402]
assert bad
for x in bad:
    assert x['model'] == 'gemini-3.8-flash' and x.get('errorCode') == 'http'
    assert 'prepayment credits are depleted' in x['error'].lower()
    assert x.get('transportFailure') and not x.get('returnedAnswer') and not x.get('text')
    assert x.get('costEstimated')
bad_keys = {x['key'] for x in bad}
bad_jobs = {f"{x['phase']}:{x['model']}:{x['itemId']}:{x['repeat']}:{x['contestant']}" for x in bad}
archive.mkdir()
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def backup(path):
    target = archive / path.name
    target.write_bytes(path.read_bytes())
    assert sha(target) == sha(path)
    return sha(target)
original_sha = backup(source)
at = datetime.now(timezone.utc).isoformat()
released = sum(Decimal(str(x['costUsd'])) for x in bad)
receipts = [{'key': x['key'], 'at': x['at'], 'status': 402, 'evidence': x['error'],
             'releasedHoldUsd': x['costUsd'], 'afterCostUsd': 0} for x in bad]
decisions = {}
for path in results.glob('decisions-*-gemini-3.8-flash.jsonl'):
    values = [json.loads(line) for line in path.read_text().splitlines()]
    removed = [x for x in values if x['key'] in bad_jobs]
    if removed:
        before_sha = backup(path)
        kept = [x for x in values if x['key'] not in bad_jobs]
        path.write_text(''.join(json.dumps(x, separators=(',', ':')) + '\n' for x in kept))
        decisions[path.name] = {'originalSha256': before_sha, 'afterSha256': sha(path),
                                'quarantinedKeys': [x['key'] for x in removed], 'kept': len(kept)}
for x in rows:
    if x['type'] == 'finish' and x['key'] in bad_keys:
        x.update(costUsd=0, costEstimated=False, graderError=False, billingResponse=True,
                 billingRejected=True, retryable=False, reconciliation='billing-reconciliation/manifest.json')
source.write_text(''.join(json.dumps(x, separators=(',', ':')) + '\n' for x in rows))
manifest = {'at': at, 'authorization': 'Owner: On 402 stop all Gemini calls, no retries, release holds only for proven rejections, never a judge error. Resume missing-only after top-up.',
            'sourceBeforeSha256': original_sha, 'sourceAfterSha256': sha(source),
            'rejectedCalls': len(bad), 'releasedHoldUsd': str(released), 'receipts': receipts,
            'decisions': decisions, 'missingJobKeys': sorted(bad_jobs),
            'historicalUnknownReserveUsd': sum(x['costUsd'] for x in rows if x['type'] == 'finish' and x.get('costEstimated')),
            'resumePolicy': 'Keep successful receipts. Gemini remains paused. Only proven no-answer rejection calls may be reissued after explicit top-up authorization.'}
(archive / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
with spend.open('a') as f:
    f.write(f'| {at} | ledger-jb billing reconciliation | gemini-3.8-flash | {len(bad)} proven HTTP 402 prepayment rejections | -{released} USD hold release, not a refund | originals and per-key evidence: examples/ledger-jb/results/billing-reconciliation/manifest.json; historical unknown holds unchanged |\n')
print(json.dumps({k: v for k, v in manifest.items() if k not in ['receipts', 'missingJobKeys', 'decisions']}, indent=2))
print(json.dumps({k: {'quarantined': len(v['quarantinedKeys']), 'kept': v['kept']} for k, v in decisions.items()}))
