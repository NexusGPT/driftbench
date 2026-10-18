"""Strict free replay of every finished phase; compares actual per-item decisions."""
import datetime
import json
import os
from pathlib import Path
import subprocess

BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[2]
phases=[('pilot',['--pilot']),('validity',['--validity']),('noise-0',['--noise','0']),('noise-1',['--noise','1']),('noise-2',['--noise','2']),('results',[])]
evidence=[]
env={**os.environ,'TMPDIR':str(ROOT/'.tmp')}
for key in ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY']:env.pop(key,None)
for model in ['gemini-3.5-flash-lite']:
    for phase,args in phases:
        path=BASE/phase/f'{model}.json'
        if not path.exists():continue
        original=json.loads(path.read_text())
        if original.get('stopped'):continue
        command=[str(ROOT/'node_modules/.bin/tsx'),'--tsconfig','examples/ledger-verify/tsconfig.json','examples/ledger-verify/lite-run.ts',model,*args,'--replay-only']
        subprocess.run(command,cwd=ROOT,env=env,check=True)
        replay=json.loads((BASE/phase/f'{model}.replay.json').read_text())
        assert replay['newCalls']==0 and replay['newSpendUsd']==0 and not replay.get('stopped'),(model,phase)
        changed=[]
        for a,b in zip(original['contestants'],replay['contestants']):
            for x,y in zip(a['decisions'],b['decisions']):
                if x!=y:changed.append(dict(contestant=a['contestant'],id=x['id'],original=x,replay=y))
        evidence.append(dict(model=model,phase=phase,items=original['items'],newCalls=0,identicalDecisions=not changed,changed=changed))
out=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),phases=evidence)
(BASE/'evidence/phase-replay-checks.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({k:v for k,v in out.items() if k!='phases'}), 'phases',len(evidence),'divergent phases',sum(not x['identicalDecisions'] for x in evidence))
assert all(x['identicalDecisions'] for x in evidence),'Replay differs; inspect evidence before claiming reproducibility'
