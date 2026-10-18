"""Recover six missing requests into a labelled addendum; never edit the closed Luna cell."""
import concurrent.futures,datetime,hashlib,json,os,re,subprocess,time
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[1];DEST=BASE/'luna-addendum';CACHE=BASE/'cache/luna-noise-addendum'
def read(p):return json.loads(p.read_text())
def rows(p):return [json.loads(x) for x in p.read_text().splitlines() if x.strip()]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def state(**v):
 v=dict(at=now(),pid=os.getpid(),**v);(DEST/'state.json').write_text(json.dumps(v,indent=2)+'\n');print(json.dumps(v),flush=True)
amend=read(DEST/'freeze-amendment.json')
def official_unchanged():
 for name,want in amend['officialHashes'].items():assert sha(BASE/name)==want,name
source=(BASE/'transport.ts').read_text()
def replace(a,b):
 global source
 assert source.count(a)==1,a;source=source.replace(a,b)
replace('  callFingerprint=fingerprint(freeze.coreSha);', '''  callFingerprint=fingerprint(freeze.coreSha);
  const amendment=JSON.parse(await readFile(resolve(base,'luna-addendum/freeze-amendment.json'),'utf8'));
  if(model!=='gpt-6-luna'||process.env.VERIFY_PHASE!=='noise-0-addendum'||!amendment.calls.some((r:any)=>r.fingerprint===callFingerprint))throw new Error('Outside authorized Luna addendum');
  const waitGate=async()=>{while(true){const g=JSON.parse(await readFile(resolve(base,'evidence/network-admission.json'),'utf8'));if(g.open&&g.model===model&&Date.now()/1000-g.lastProbeEpoch<75)return;await new Promise(r=>setTimeout(r,1000));}};''')
replace(".find(r=>!['quota-pending','billing-pending'].includes(r.status)",".find(r=>!['quota-pending','billing-pending','transport-failure'].includes(r.status)")
replace("  await acquire();\n  budget('reserve'", "  await waitGate();\n  await acquire();\n  budget('reserve'")
replace('      await acquire();started=true;', '      await waitGate();await acquire();started=true;')
replace('    const long=!isGoogle&&input>272000;', '    const written=isGoogle?0:Math.min(input-cached,usage.prompt_tokens_details?.cache_write_tokens??0);\n    const long=!isGoogle&&input>272000;')
replace('((input-cached)*0.10*(long?2:1)+cached*0.01*(long?2:1)+output*0.50*(long?1.5:1))/1e6;', '((input-cached-written)*0.10*(long?2:1)+cached*0.01*(long?2:1)+written*0.125*(long?2:1)+output*0.50*(long?1.5:1))/1e6;')
generated=BASE/'luna-addendum-transport.generated.ts';generated.write_text(source)
execution=dict(at=now(),originalTransportSha256=sha(BASE/'transport.ts'),transportSha256=sha(generated),amendmentSha256=sha(DEST/'freeze-amendment.json'),captureSha256=sha(BASE/'prepare-luna-addendum.ts'),recoverySha256=sha(Path(__file__)),requestsSha256=sha(CACHE/'requests.json'),model='gpt-6-luna',reasoning='medium',timeoutMs=300000,capUsd=40,concurrency=2,returnedAnswersResent=0)
(DEST/'execution-freeze.json').write_text(json.dumps(execution,indent=2)+'\n')
official_unchanged()
state(status='waiting for Haiku verification and provider health gate')
while not (read(BASE/'evidence/haiku-test-timeout-recovery.json').get('status')=='complete' and read(BASE/'evidence/finalizer-state.json').get('status')=='offline evidence ready for review'):time.sleep(5)
requests=read(CACHE/'requests.json');assert len(requests)==6
connections=re.compile(r'ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|could not be reached|ran past \d+ ms|connect.*timeout',re.I)
env=dict(os.environ,TMPDIR=str(ROOT/'.tmp'),VERIFY_PHASE='noise-0-addendum',VERIFY_OPENAI_KEY_FILE=str(Path.home()/'.nexus-secrets/openai.key'))
for name in ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY','VERIFY_GEMINI_KEY_FILE']:env.pop(name,None)
tsx=[str(ROOT/'node_modules/.bin/tsx'),'--tsconfig','examples/ledger-verify/tsconfig.json']
def attempt(r):
 p=CACHE/(r['fingerprint']+'.answered.json')
 if p.exists():return read(p)
 count=len(list(CACHE.glob(r['fingerprint']+'.attempt-*.json')))+1
 result=subprocess.run(tsx+[str(generated),'--model','gpt-6-luna','--system-prompt',r['prompt']['system']],input=r['prompt']['user'],text=True,capture_output=True,cwd=ROOT,env=env,check=True)
 if result.stderr:(CACHE/(r['fingerprint']+f'.attempt-{count}.stderr.log')).write_text(result.stderr)
 output=json.loads(result.stdout)
 receipts=[x for x in rows(BASE/'receipts/calls.jsonl')+rows(BASE/'receipts/errors.jsonl') if x.get('phase')=='noise-0-addendum' and x.get('fingerprint')==r['fingerprint']]
 latest=sorted(receipts,key=lambda x:x['at'])[-1]
 answered=not output.get('is_error')
 v=dict(key=r['key'],fingerprint=r['fingerprint'],labels=r['labels'],output=output,receipt=latest['id'],returnedModelAnswer=answered,attempt=count)
 (CACHE/(r['fingerprint']+f'.attempt-{count}.json')).write_text(json.dumps(v,indent=2)+'\n')
 if answered:p.write_text(json.dumps(v,indent=2)+'\n')
 else:
  assert connections.search(output.get('result','')),output.get('result')
  time.sleep(30)
 return v
pending=requests
while pending:
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(attempt,pending))
 pending=[r for r in requests if not (CACHE/(r['fingerprint']+'.answered.json')).exists()]
 state(status='missing-only recovery' if pending else 'all six requests answered',answered=6-len(pending),remaining=len(pending))
recovered=[read(CACHE/(r['fingerprint']+'.answered.json')) for r in requests]
runtime=read(BASE/'evidence/runtime-freeze.json');original_dir=BASE/'recordings'/runtime['recordingsId']/'noise-0/longjudge-verify';target=DEST/'recordings/longjudge-verify';target.mkdir(parents=True,exist_ok=True)
entries=rows(original_dir/'gpt-6-luna.jsonl');final={r['key']:r for r in recovered if r['labels']['order']=='single'};assert len(final)==4
for r in entries:
 if r['key'] in final:
  v=final[r['key']];assert r.get('failure') and not r['text'];r.pop('failure');r.update(text=v['output']['result'],costUsd=v['output']['total_cost_usd'],recoveredReceipt=v['receipt'])
(target/'gpt-6-luna.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in entries));(target/'program-outputs.jsonl').write_bytes((original_dir/'program-outputs.jsonl').read_bytes())
subprocess.run(tsx+[str(BASE/'replay-stable.ts'),'gpt-6-luna','noise-0','--addendum'],cwd=ROOT,env=env,check=True)
official_unchanged()
receipts=[r for r in rows(BASE/'receipts/calls.jsonl') if r.get('phase')=='noise-0-addendum'];fees=sum(r['costUsd'] for r in receipts)
state(status='complete',answered=6,returnedAnswersResent=0,officialFilesUnchanged=len(amend['officialHashes']),recoveredMissingFinals=4,supplementalIntermediateAnswers=2,newSettledUsd=fees,receiptIds=[r['id'] for r in receipts],execution=execution)
