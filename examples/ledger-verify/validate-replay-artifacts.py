"""Verify prior exact replays for unchanged phases and the fresh Haiku recovery replay."""
import datetime,hashlib,json
from pathlib import Path
BASE=Path(__file__).resolve().parent
prior=json.loads((BASE/'evidence/phase-replay-checks.json').read_text());proof=[]
for row in prior['phases']:
 model,phase=row['model'],row['phase'];original=BASE/phase/f'{model}.json';replayed=BASE/phase/f'{model}.replay.json'
 a=json.loads(original.read_text());b=json.loads(replayed.read_text())
 assert not a.get('stopped') and not b.get('stopped') and b['newCalls']==0 and b['newSpendUsd']==0,(model,phase)
 assert len(a['contestants'])==len(b['contestants'])==2
 for x,y in zip(a['contestants'],b['contestants']):assert x['decisions']==y['decisions'],(model,phase,x['contestant'])
 proof.append(dict(model=model,phase=phase,items=a['items'],newCalls=0,identicalDecisions=True,changed=[],originalSha256=hashlib.sha256(original.read_bytes()).hexdigest(),replaySha256=hashlib.sha256(replayed.read_bytes()).hexdigest(),verification='Fresh per-item recorded-chain reconstruction' if (model,phase)==('haiku','results') else 'Revalidated prior exact replay against unchanged original decisions'))
assert len(proof)==16
(BASE/'evidence/phase-replay-checks.json').write_text(json.dumps(dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),phases=proof),indent=2)+'\n')
p=BASE/'evidence/request-attribution.json';trace=json.loads(p.read_text());fresh=json.loads((BASE/'cache/stable-replay/haiku/results/evidence.json').read_text())
trace['rows']=[r for r in trace['rows'] if not (r['model']=='haiku' and r['phase']=='test')]+fresh['rows'];trace['haikuTestRecoveryTrace']='cache/stable-replay/haiku/results/evidence.json';p.write_text(json.dumps(trace,indent=2)+'\n')
print(json.dumps(dict(phases=len(proof),identicalDecisions=True,newCalls=0)))
