"""Owner-authorized five unanswered DEV requests, then the conditional 45 USD gate."""
import collections,datetime,hashlib,json,os,subprocess,sys
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[1];CELL=BASE/'sonnet';MODEL='claude-sonnet-5-5'
def read(p):return json.loads(p.read_text())
def write(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def progress(**v):write(CELL/f'{MODEL}.progress.json',dict(at=now(),model=MODEL,pid=os.getpid(),phase='cache-off-remeasure',**v));print(json.dumps(v),flush=True)
assert read(CELL/'evidence/cache-off-amendment.json')['status']=='frozen before cache-disabled calls'
initial=read(CELL/'evidence/cost-sample.json');selection=read(CELL/'evidence/cache-off-cost-selection.json');outcomes=[]
env=dict(os.environ,TMPDIR=str(ROOT/'.tmp'),VERIFY_PHASE='pilot',DISABLE_PROMPT_CACHING='1')
for k in ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY']:env.pop(k,None)
for i,r in enumerate(selection['requests']):
 p=CELL/'cache'/f'cache-off-sample-{i}.json'
 if p.exists():v=read(p)
 else:
  ran=subprocess.run(['python3',str(BASE/'transport-retry.py'),'--model',MODEL,'--system-prompt',r['prompt']['system']],input=r['prompt']['user'],text=True,capture_output=True,cwd=ROOT,env=env,check=True)
  if ran.stderr:(CELL/'logs'/f'cache-off-sample-{i}.stderr.log').write_text(ran.stderr)
  v=json.loads(ran.stdout);write(p,v)
 assert v.get('verify_answered'),v
 receipts=[json.loads(x) for x in (CELL/'receipts/calls.jsonl').read_text().splitlines()]
 receipt=next(x for x in receipts if x['id']==v['verify_receipt_id']);native=read(Path(receipt['nativeReceipt']))
 assert 'claude-sonnet-5-5' in native['modelUsage']
 assert native['usage'].get('cache_creation_input_tokens',0)==0,'Cache disable was not applied'
 outcomes.append(dict(index=i,labels=r['labels'],costUsd=v['total_cost_usd'],receipt=v['verify_receipt_id'],fingerprint=receipt['fingerprint'],usage=native['usage'],modelUsage=native['modelUsage'],isError=v.get('is_error',False)))
 progress(status='running',requestsFinished=len(outcomes))
 assert not v.get('is_error'),'Returned sample error stays recorded; inspect before gate'
costs=collections.defaultdict(list)
for r in outcomes:costs[(r['labels']['contestant'],r['labels']['order'])].append(r['costUsd'])
cascade_max=max(r['costUsd'] for r in outcomes if r['labels']['contestant']!='promptfoo')
components=[]
for r in initial['components']:
 values=costs[(r['contestant'],r['order'])];unit=sum(values)/len(values) if values else cascade_max
 components.append(dict(contestant=r['contestant'],order=r['order'],referenceRequests=r['referenceRequests'],unitCostUsd=unit,projectedUsd=unit*r['referenceRequests']))
projected=sum(r['projectedUsd'] for r in components);budget=read(CELL/'receipts/budget.json');held=sum(r['usd'] for r in budget['reservations'].values());total=projected+budget['spentUsd']+held
result=dict(at=now(),sampleRequests=5,costUsd=sum(r['costUsd'] for r in outcomes),outcomes=outcomes,components=components,projectedFuture379UnitsUsd=projected,priorAndCalibrationSettledUsd=budget['spentUsd'],holdsUsd=held,projected379UnitsUsd=total,capUsd=45,proceed=total<=45,method='Same stage-weighted full-run volumes as initial sample. Unsampled cascade stages use highest sampled cascade fee. Conservatively add all calibration fees and holds without credit for cached reuse.',initialProjectionUsd=initial['projected379UnitsUsd'],cacheCreationTokens=0)
write(CELL/'evidence/cache-off-cost-sample.json',result)
if total>45:
 progress(status='owner budget decision',projected379UnitsUsd=total,pilotStarted=False,sealedTestStarted=False);sys.exit(2)
# Owner preauthorizes the higher cap only when this measured projection passes.
assert not budget['activeCalls'];budget['capUsd']=45;write(CELL/'receipts/budget.json',budget)
for name in ['runtime-freeze.json','pilot-runtime-freeze.json']:
 p=CELL/'evidence'/name;v=read(p);v['capUsd']=45;v['conditionalBudgetEvidence']='sonnet/evidence/cache-off-cost-sample.json';write(p,v)
write(CELL/'evidence/cap45-activation.json',dict(at=now(),capUsd=45,includingHolds=True,projectionUsd=total,ownerAuthorization='45 USD or less means run under a 45 USD hard stop',runtimeSha256=hashlib.sha256((CELL/'evidence/runtime-freeze.json').read_bytes()).hexdigest()))
progress(status='cost gate passed',projected379UnitsUsd=total)
sys.exit(subprocess.run(['python3',str(BASE/'new-cell-supervise.py'),MODEL],cwd=ROOT,env=env).returncode)
