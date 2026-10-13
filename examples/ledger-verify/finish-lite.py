"""Offline reporting for the separately frozen Flash Lite cell, including cap stops."""
import datetime,hashlib,json,os,subprocess,sys,time
from pathlib import Path
BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[1]
LITE=BASE/'lite'
MODEL='gemini-3.5-flash-lite'
def load(p):return json.loads(p.read_text())
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def ready():
 try:s=load(LITE/f'{MODEL}.progress.json')
 except (FileNotFoundError,json.JSONDecodeError):return False
 return s.get('phase')=='all' or s.get('status') in ['stopped; requires inspection','runner failed']
if '--wait' in sys.argv:
 (LITE/'evidence/finalizer-state.json').write_text(json.dumps(dict(pid=os.getpid(),at=stamp(),status='waiting',target=MODEL),indent=2)+'\n')
 while not ready():time.sleep(20)
assert ready()
env=dict(os.environ,TMPDIR=str(ROOT/'.tmp'))
for key in ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY','VERIFY_OPENAI_KEY_FILE','VERIFY_GEMINI_KEY_FILE']:env.pop(key,None)
commands=[
 [str(ROOT/'node_modules/.bin/tsx'),'--tsconfig','examples/ledger-verify/tsconfig.json','examples/ledger-verify/replay-item-history.ts'],
 [sys.executable,str(LITE/'output_limits.py')],

 [sys.executable,str(LITE/'summarize.py')],
]
for i,cmd in enumerate(commands):
 with (LITE/'logs'/f'finalize-{i}.log').open('w') as f:subprocess.run(cmd,cwd=ROOT,env=env,stdout=f,stderr=subprocess.STDOUT,check=True)
 if i==0:
  h=load(LITE/'evidence/item-history-replay.json');assert all(p['identicalDecisions'] for p in h['phases'])
  h['phases']=[p for p in h['phases'] if not p.get('originalStopped')]
  (LITE/'evidence/phase-replay-checks.json').write_text(json.dumps(h,indent=2)+'\n')
  (LITE/'evidence/request-attribution.json').write_bytes((LITE/'evidence/history-request-attribution.json').read_bytes())
cells=load(LITE/'evidence/cells.json');assert cells['fees']['maximumAccountedUsd']<=load(LITE/'evidence/runtime-freeze.json')['capUsd']
assert not cells['outputLimitErrors']['unmappedLimits']
for f in ['reporting-freeze.json']:
 for path,h in load(LITE/'evidence'/f)['sourceHashes'].items():assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==h,path
for c in cells['cells']:
 c['additionalCell']=True;c['validityPassedScope']='Planted mutation checks only; full DEV cheater margin not established'
 c['claimStatus']='Additional cell; multiplicity policy pending collator. No confirmatory win claim.'
 for variant in [c,c.get('productFinal',{})]:
  for label in ['official','audited']:
   if variant.get(label):
    variant[label]['holmStatus']='Additional model cell, outside original 18-cell family; adjustment pending collator'
    variant[label].pop('bonferroni18UpperBound',None)
 cells['additionalCellAmendment']=load(LITE/'evidence/model-amendment.json')
 cells['reasoningApplied']=load(LITE/'evidence/reasoning-applied.json')
 cells['predeclaredCheaterMarginEstablished']=False
(LITE/'evidence/cells.json').write_text(json.dumps(cells,indent=2)+'\n')
r=load(LITE/'evidence/phase-replay-checks.json');assert all(p['identicalDecisions'] and p['newCalls']==0 for p in r['phases'])
result=dict(at=stamp(),status='offline evidence ready for review',model=MODEL,phases=len(r['phases']),complete=load(LITE/f'{MODEL}.progress.json').get('phase')=='all',fees=cells['fees'],replayNewCalls=0,unmappedLimits=0)
(LITE/'evidence/finalizer-state.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
