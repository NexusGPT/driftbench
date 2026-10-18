"""Read-only live counts for the three verify runners."""
from collections import Counter
from datetime import datetime, timezone
import fcntl
import json
from pathlib import Path

BASE=Path(__file__).resolve().parent
runtime=json.loads((BASE/'evidence/runtime-freeze.json').read_text())
with (BASE/'receipts/budget.json').open() as stream:
    fcntl.flock(stream,fcntl.LOCK_SH);budget=json.load(stream)
result=dict(at=datetime.now(timezone.utc).isoformat(),settledUsd=budget['spentUsd'],
    reservedUsd=sum(x['usd'] for x in budget['reservations'].values()),capUsd=budget['capUsd'],
    active=Counter(x['model'] for x in budget.get('activeCalls',{}).values()),models={})
for model in ['haiku','gpt-6-luna','gemini-3.8-flash']:
    progress=json.loads((BASE/f'{model}.progress.json').read_text())
    phase=progress['phase'];cassette_phase='test' if phase=='results' else phase
    namespace=runtime['pilotRecordingsId'] if phase=='pilot' else runtime.get('recordingsId',runtime['id'])
    path=BASE/'recordings'/namespace/cassette_phase/'longjudge-verify'/f'{model}.jsonl'
    rows=[json.loads(line) for line in path.read_text().splitlines() if line] if path.exists() else []
    result['models'][model]=dict(phase=phase,status=progress['status'],
        uniqueFinalPrompts=Counter(r['contestant'] for r in {r['key']:r for r in rows}.values() if r.get('order')=='single'),
        terminalTransportOutputs=sum('failure' in r for r in rows))
quota=BASE/'receipts/quota.jsonl'
result['quota429Events']=len(quota.read_text().splitlines()) if quota.exists() else 0
print(json.dumps(result))
