"""Exact offline replay and fee reconciliation for one additional model cell."""
import datetime,hashlib,json,os,subprocess,sys
from pathlib import Path
PARENT=Path(__file__).resolve().parent;ROOT=PARENT.parents[1]
MODEL=sys.argv[1];assert MODEL in ['claude-sonnet-5-5','gpt-6.1-sol'];BASE=PARENT/('sol61' if MODEL=='gpt-6.1-sol' else 'sonnet')
def read(p):return json.loads(p.read_text())
assert read(BASE/f'{MODEL}.progress.json')['status']=='complete'
env=dict(os.environ,TMPDIR=str(ROOT/'.tmp'))
for k in ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY']:env.pop(k,None)
cmds=[[str(ROOT/'node_modules/.bin/tsx'),'--tsconfig','examples/ledger-verify/tsconfig.json',str(PARENT/'new-cell-trace.ts'),MODEL],
 ['python3',str(BASE/'output_limits.py')],['python3',str(BASE/'summarize.py')]]
for i,cmd in enumerate(cmds):
 with (BASE/'logs'/f'finalize-{i}.log').open('w') as log:subprocess.run(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
 if i==0:
  r=read(BASE/'evidence/item-history-replay.json');assert len(r['phases'])==6 and all(p['identicalDecisions'] and p['newCalls']==0 for p in r['phases'])
  (BASE/'evidence/phase-replay-checks.json').write_text(json.dumps(r,indent=2)+'\n');(BASE/'evidence/request-attribution.json').write_bytes((BASE/'evidence/history-request-attribution.json').read_bytes())
cells=read(BASE/'evidence/cells.json');assert cells['fees']['maximumAccountedUsd']<=25;assert not cells['outputLimitErrors']['unmappedLimits']
for p,h in read(BASE/'evidence/reporting-freeze.json')['sourceHashes'].items():assert hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h,p
for c in cells['cells']:
 c['additionalCell']=True;c['validityPassedScope']='Planted mutation checks only; full DEV cheater margin not established';c['claimStatus']='Additional cell; multiplicity policy pending collator'
 for v in [c,c['productFinal']]:
  for label in ['official','audited']:v[label]['holmStatus']='Additional cell, outside original 18-cell family';v[label].pop('bonferroni18UpperBound',None)
cells['modelAmendment']=read(BASE/'evidence/model-amendment.json');(BASE/'evidence/cells.json').write_text(json.dumps(cells,indent=2)+'\n')
state=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),model=MODEL,status='offline evidence ready for review',complete=True,phases=6,replayNewCalls=0,unmappedLimits=0,fees=cells['fees'])
(BASE/'evidence/finalizer-state.json').write_text(json.dumps(state,indent=2)+'\n');print(json.dumps({k:v for k,v in state.items() if k!='fees'}))
