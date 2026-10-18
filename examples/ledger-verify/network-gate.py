"""Provider health admission gate. Probes carry no credential and generate no model tokens."""
import datetime,json,os,re,subprocess,time
from pathlib import Path
BASE=Path(__file__).resolve().parent
CONTROL=BASE/'evidence/network-control.json';STATE=BASE/'evidence/network-admission.json';LOG=BASE/'evidence/network-probes.jsonl'
HOSTS={'gpt-6-luna':'api.openai.com','haiku':'api.anthropic.com','claude-sonnet-5-5':'api.anthropic.com','gpt-6.1-sol':'api.openai.com'}
CONNECTION=re.compile(r'ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|connect(?:ion)?[^\n]{0,40}(?:timeout|reset|refused|closed)|fetch failed|could not be reached|ran past \d+ ms|socket hang up|DNS',re.I)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def read(p):return json.loads(p.read_text())
def save(value):
 p=STATE.with_suffix('.tmp');p.write_text(json.dumps(value,indent=2)+'\n');p.replace(STATE)
def paid_streak(model,since):
 base=BASE/({'claude-sonnet-5-5':'sonnet','gpt-6.1-sol':'sol61'}.get(model,''));events={}
 for name in ['calls','errors']:
  p=base/f'receipts/{name}.jsonl'
  if not p.exists():continue
  for line in p.read_text().splitlines():
   try:r=json.loads(line)
   except json.JSONDecodeError:continue
   if r.get('model')!=model or r.get('at','')<since:continue
   if name=='calls':events[r['id']]=(r['at'],False)
   elif CONNECTION.search(r.get('message','')) and not r.get('returnedEnvelope'):
    native=Path(r['nativeReceipt']) if r.get('nativeReceipt') else None
    if r.get('noAnswer') is not True and native and native.exists() and native.stat().st_size:continue
    events[r['id']]=(r['at'],True)
 streak=0
 for at,bad in sorted(events.values()):streak=streak+1 if bad else 0
 return streak

def main():
 model=None;streak=0;failures=0;cooldown=0;epoch=now();last=0
 while True:
  control=read(CONTROL)
  if control.get('stop'):
   save(dict(at=now(),pid=os.getpid(),status='stopped',model=model,open=False));return
  if control.get('model')!=model:
   model=control['model'];assert model in HOSTS;streak=0;failures=0;cooldown=0;epoch=now();last=0
  if time.time()<cooldown:
   save(dict(at=now(),pid=os.getpid(),model=model,open=False,status='ten-minute connection cooldown',cooldownUntil=cooldown,healthyStreak=0));time.sleep(min(30,cooldown-time.time()));continue
  paid=paid_streak(model,epoch)
  if paid>=3:
   cooldown=time.time()+600;streak=0;failures=0;epoch=now();continue
  if time.time()-last<30:time.sleep(min(5,30-(time.time()-last)));continue
  last=time.time();host=HOSTS[model]
  cmd="const host=process.argv[1];try{const r=await fetch('https://'+host+'/',{signal:AbortSignal.timeout(20000)});console.log(JSON.stringify({healthy:r.status>=200&&r.status<500&&r.status!==408&&r.status!==429,status:r.status}));}catch(e){console.log(JSON.stringify({healthy:false,error:String(e),cause:String(e.cause??'')}));}"
  result=subprocess.run(['node','--input-type=module','-e',cmd,host],text=True,capture_output=True)
  try:probe=json.loads(result.stdout)
  except json.JSONDecodeError:probe=dict(healthy=False,error=result.stderr or 'Probe process returned no JSON')
  probe.update(at=now(),model=model,host=host,providerGeneration=False)
  with LOG.open('a') as f:f.write(json.dumps(probe)+'\n')
  if probe['healthy']:streak+=1;failures=0
  else:streak=0;failures+=1
  if failures>=3:cooldown=time.time()+600;failures=0;epoch=now()
  state=dict(at=now(),lastProbeEpoch=time.time(),pid=os.getpid(),model=model,open=streak>=10,healthyStreak=streak,connectionFailureStreak=failures,paidConnectionFailureStreak=paid,concurrency=2,status='open' if streak>=10 else 'health gate',cooldownUntil=cooldown)
  save(state);print(json.dumps(state),flush=True)
if __name__=='__main__':main()
