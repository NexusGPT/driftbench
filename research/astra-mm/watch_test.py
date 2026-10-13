"""Read checkpoints and finish offline analysis only when all sealed requests are present."""
import collections,datetime,json,pathlib,subprocess,time
R=pathlib.Path(__file__).resolve().parent;D=R/'data';ROOT=R.parents[1]
def rows(p):
 if not p.exists():return []
 out=[]
 for l in p.read_text().splitlines():
  if l.strip():
   try:out.append(json.loads(l))
   except json.JSONDecodeError:pass
 return out
tasks=rows(D/'test-tasks.jsonl');expected=len(json.loads((D/'test.json').read_text()));peak=0;gem_peak=0;samples=0
while True:
 base={r['id']:r for r in rows(D/'test-base.jsonl')};calls=rows(D/'test-calls.jsonl');keys={r['key'] for r in calls}
 escalated={i for i,r in base.items() if r.get('providerRefused') or not(len(r['games'])==2 and r['games'][0]==r['games'][1] and r['games'][0] in ('A','B'))}
 pending=[t for t in tasks if t['id'] in escalated and t['key'] not in keys]
 status={'time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'base':len(base),'expected':expected,'escalations':len(escalated),'pending':len(pending),'panelReceipts':dict(collections.Counter(r['provider'] for r in calls))}
 print(json.dumps(status),flush=True)
 if len(base)==expected and not pending:break
 for _ in range(50):
  slots=[]
  for f in (R/'tmp/call-slots').iterdir():
   try:slots.append(json.loads(f.read_text()))
   except (FileNotFoundError,json.JSONDecodeError):pass
  assert len(slots)<=4
  gems=sum(x['provider']=='gemini' for x in slots);assert gems<=2
  peak=max(peak,len(slots));gem_peak=max(gem_peak,gems);samples+=1
  time.sleep(1)
 (D/'test-concurrency-observation.json').write_text(json.dumps({'oneSecondSamples':samples,'maximumObservedSlots':peak,'maximumObservedGeminiSlots':gem_peak,'mechanism':'Four atomic O_EXCL slot files, Gemini thread pool limited to two.'},indent=2)+'\n')
TSX='/Users/assem/Documents/GitHub/driftbench/node_modules/.bin/tsx'
commands=[[TSX,'--tsconfig','research/astra-mm/tsconfig.json','research/astra-mm/decisions.mts','test'],['python3','research/astra-mm/paired.py','test'],[TSX,'--tsconfig','research/astra-mm/tsconfig.json','research/astra-mm/audit-base.mts','test'],['python3','research/astra-mm/report_test.py']]
for cmd in commands:subprocess.run(cmd,cwd=ROOT,check=True,stderr=subprocess.STDOUT)
print('TEST_COMPLETE',flush=True)
