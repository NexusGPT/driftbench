"""Recover zero-output TEST timeouts under the owner network gate, without replaying answers."""
import concurrent.futures,datetime,hashlib,json,os,re,subprocess,sys,time
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[1]
STATE=BASE/'evidence/haiku-test-timeout-recovery.json';CACHE=BASE/'cache/haiku-test-outage'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def read(p):return json.loads(p.read_text())
def rows(p):return [json.loads(x) for x in p.read_text().splitlines() if x.strip()] if p.exists() else []
def digest(data):return hashlib.sha256(data).hexdigest()
def save(**value):
 value=dict(at=now(),pid=os.getpid(),**value);STATE.write_text(json.dumps(value,indent=2)+'\n');print(json.dumps(value),flush=True)
def archive(p,target):
 data=p.read_bytes()
 if target.exists():assert target.read_bytes()==data
 else:target.write_bytes(data)
 return data

def main():
 assert read(BASE/'haiku.progress.json')['status']=='complete'
 amendment=read(BASE/'evidence/haiku-test-timeouts.json')
 calls=amendment['calls']  # Initial TEST receipts only; retry receipts never expand the target set.
 for r in calls:assert Path(r['nativeReceipt']).exists() and not Path(r['nativeReceipt']).read_text().strip()
 amendment.update(calls=calls,callsCollectedAt=now(),unknownHoldsRetainedUsd=len(calls)*.5)
 (BASE/'evidence/haiku-test-timeouts.json').write_text(json.dumps(amendment,indent=2)+'\n')
 env=dict(os.environ,TMPDIR=str(ROOT/'.tmp'),VERIFY_PHASE='test')
 for name in ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY','VERIFY_OPENAI_KEY_FILE','VERIFY_GEMINI_KEY_FILE']:env.pop(name,None)
 tsx=[str(ROOT/'node_modules/.bin/tsx'),'--tsconfig','examples/ledger-verify/tsconfig.json']
 subprocess.run(tsx+[str(BASE/'prepare-haiku-test-outage.ts')],cwd=ROOT,env=env,check=True)
 requests=read(CACHE/'requests.json');assert len(requests)==len(calls)
 report=BASE/'results/haiku.json';runtime=read(BASE/'evidence/runtime-freeze.json');cassette=BASE/'recordings'/runtime['recordingsId']/'test/longjudge-verify/haiku.jsonl'
 original_report=archive(report,report.with_name('haiku.pre-test-timeout-recovery.json'));original_cassette=archive(cassette,cassette.with_name('haiku.pre-test-timeout-recovery.jsonl'))
 initial=json.loads(original_report);assert initial['items']==221 and not initial.get('stopped')
 source=(BASE/'transport.ts').read_text();source_hash=digest(source.encode())
 def replace(old,new):
  nonlocal source
  assert source.count(old)==1,old;source=source.replace(old,new)
 replace('import { appendFile, mkdir, readFile }','import { appendFile, mkdir, readFile, writeFile }')
 replace('  callFingerprint=fingerprint(freeze.coreSha);', '''  callFingerprint=fingerprint(freeze.coreSha);
  const recovery=JSON.parse(await readFile(resolve(base,'evidence/haiku-test-timeouts.json'),'utf8'));
  if(model!=='haiku'||process.env.VERIFY_PHASE!=='test'||!recovery.calls.some((r:any)=>r.fingerprint===callFingerprint))throw new Error('Outside authorized TEST timeout recovery');
  const excludedIds=new Set(recovery.calls.map((r:any)=>r.id));''')
 replace('.find(r=>!', '.find(r=>!excludedIds.has(r.id)&&!')
 replace("  await acquire();\n  budget('reserve'", '''  while(true){
    const gate=JSON.parse(await readFile(resolve(base,'evidence/network-admission.json'),'utf8'));
    if(gate.open&&gate.model===model&&Date.now()/1000-gate.lastProbeEpoch<75)break;
    await new Promise(r=>setTimeout(r,1000));
  }
  await writeFile(resolve(base,'cache/haiku-test-outage',callFingerprint+'.'+id+'.claim.json'),JSON.stringify({id,at:new Date().toISOString(),fingerprint:callFingerprint}),{flag:'wx'});
  await acquire();
  budget('reserve' ''')
 generated=BASE/'haiku-test-timeout-transport.generated.ts';generated.write_text(source)
 execution=dict(authorization=amendment['authorization'],originalTransportSha256=source_hash,recoveryTransportSha256=digest(source.encode()),maxAdditionalSubmissionsEach=None,unknownHoldsRetainedUsd=amendment['unknownHoldsRetainedUsd'],networkPolicy='evidence/network-pause-20261013.json',requests=[dict(key=r['key'],fingerprint=r['fingerprint']) for r in requests])
 (BASE/'evidence/haiku-test-timeout-execution.json').write_text(json.dumps(dict(at=now(),**execution),indent=2)+'\n')
 if '--prepare-only' in sys.argv:print(json.dumps(dict(requests=len(requests),providerCalls=0)));return
 before={r['id'] for r in rows(BASE/'receipts/calls.jsonl')}
 save(status='waiting for network gate; missing-only recovery',**execution)
 def retry(request):
  answer=CACHE/(request['fingerprint']+'.answered.json')
  if answer.exists():return read(answer)
  attempt=len(list(CACHE.glob(request['fingerprint']+'.attempt-*.json')))
  attempt+=1
  ran=subprocess.run(tsx+[str(generated),'--model','haiku','--system-prompt',request['prompt']['system']],input=request['prompt']['user'],text=True,capture_output=True,cwd=ROOT,env=env,check=True)
  if ran.stderr:(CACHE/(request['fingerprint']+f'.attempt-{attempt}.stderr.log')).write_text(ran.stderr)
  response=json.loads(ran.stdout)
  receipts=[r for r in rows(BASE/'receipts/calls.jsonl') if r.get('fingerprint')==request['fingerprint'] and r.get('phase')=='test']
  errors=[r for r in rows(BASE/'receipts/errors.jsonl') if r.get('fingerprint')==request['fingerprint'] and r.get('phase')=='test']
  latest=sorted(receipts+errors,key=lambda x:x['at'])[-1]
  native=Path(latest['nativeReceipt']) if latest.get('nativeReceipt') else None
  native_nonempty=bool(native and native.exists() and native.stat().st_size)
  answered=not response.get('is_error') or native_nonempty
  value=dict(key=request['key'],fingerprint=request['fingerprint'],labels=request['labels'],output=response,receipt=latest['id'],attempt=attempt,returnedModelAnswer=answered,use='initial answered finals preserved; only transport-missing finals are replaced')
  (CACHE/(request['fingerprint']+f'.attempt-{attempt}.json')).write_text(json.dumps(value,indent=2)+'\n')
  if answered:answer.write_text(json.dumps(value,indent=2)+'\n');return value
  assert re.search(r'ran past \d+ ms|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|connect.*timeout',response.get('result',''),re.I),response.get('result')
  time.sleep(30)
  return value
 recovered=[]
 pending=list(requests)
 while pending:
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:attempted=list(pool.map(retry,pending))
  recovered.extend(r for r in attempted if r['returnedModelAnswer'])
  answered={r['fingerprint'] for r in recovered}
  pending=[r for r in requests if r['fingerprint'] not in answered]
  save(status='recovering missing-only under network gate' if pending else 'all missing requests returned',**execution,answered=len(recovered),remaining=len(pending))
 assert report.read_bytes()==original_report and cassette.read_bytes()==original_cassette
 missing={(c['contestant'],d['id']) for c in initial['contestants'] for d in c['decisions'] if d.get('missing',0)>0 or type(d.get('pass')) is not bool}
 final_recoveries={r['key']:r for r in recovered if (r['labels']['contestant'],r['labels']['item']) in missing and r['labels']['order']=='single'}
 recorded=[json.loads(x) for x in original_cassette.decode().splitlines()];replacements=0
 for row in recorded:
  if row['key'] not in final_recoveries:continue
  assert 'failure' in row and not row['text'];v=final_recoveries[row['key']];out=v['output'];row.pop('failure',None)
  row.update(text=out.get('result',''),costUsd=out.get('total_cost_usd',0),recoveredReceipt=v['receipt'])
  if out.get('is_error'):row.update(text='',failure=out['result'])
  replacements+=1
 assert replacements==len(final_recoveries)
 cassette.write_text(''.join(json.dumps(r)+'\n' for r in recorded))
 subprocess.run(tsx+[str(BASE/'run.ts'),'haiku','--replay-only'],cwd=ROOT,env=env,check=True)
 replay=read(BASE/'results/haiku.replay.json');assert replay['newCalls']==0
 preserved=0
 for original,updated in zip(initial['contestants'],replay['contestants']):
  for old,new in zip(original['decisions'],updated['decisions']):
   if (original['contestant'],old['id']) not in missing:assert old==new;preserved+=1
 assert preserved==442-len(missing)
 replay['recovery']={'initialReport':'haiku.pre-test-timeout-recovery.json','missingFinalsRecovered':replacements,'answeredDecisionsPreserved':preserved,'providerCallsDuringReplay':0}
 report.write_text(json.dumps(replay,indent=2)+'\n')
 receipts=[r for r in rows(BASE/'receipts/calls.jsonl') if r.get('model')=='haiku' and r.get('phase')=='test' and r.get('fingerprint') in {x['fingerprint'] for x in requests} and r['id'] not in {x['id'] for x in calls}]
 save(status='complete',**execution,outcomes=recovered,newReceiptIds=[r['id'] for r in receipts],newSettledUsd=sum(r['costUsd'] for r in receipts),primaryReportSha256=digest(report.read_bytes()),primaryCassetteSha256=digest(cassette.read_bytes()),initialDecisionsPreserved=preserved,primaryResultsReplaced=replacements,returnedAnswersResent=0,transportMissingFinalItems=0)
 with (BASE/'logs/haiku-test-timeout-finalize.log').open('w') as log:subprocess.run(['python3',str(BASE/'finish.py'),'--allow-daily-quota'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
if __name__=='__main__':main()
