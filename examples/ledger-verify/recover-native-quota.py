"""Recover exact unanswered native-quota requests, with one probe before a two-worker wave."""
import concurrent.futures,datetime,fcntl,hashlib,json,os,subprocess,time
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[1];CELL=BASE/'sonnet';MODEL='claude-sonnet-5-5'
def read(p):return json.loads(p.read_text())
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def main():
 freeze=read(CELL/'evidence/native-quota-recovery.json')
 requests=read(CELL/'cache/native-quota-recovery/requests.json')
 assert len(requests)==freeze['quotaRequests']==159
 assert hashlib.sha256((CELL/'cache/native-quota-recovery/requests.json').read_bytes()).hexdigest()==freeze['requestsSha256']
 assert {(r['phase'],r['fingerprint']) for r in requests}=={(r['phase'],r['fingerprint']) for r in freeze['calls']}
 reset=datetime.datetime.fromisoformat(freeze['nativeResetClaim'].replace('Z','+00:00')).timestamp()
 while True:
  gate=read(BASE/'evidence/network-admission.json')
  if time.time()>=reset and gate.get('model')==MODEL and gate.get('open') and gate['healthyStreak']>=10 and time.time()-gate['lastProbeEpoch']<75:break
  time.sleep(5)
 assert not read(BASE/'sol61/receipts/budget.json')['activeCalls'], 'Another model cell is active'
 with (CELL/'receipts/budget.json').open('r+') as f:
  fcntl.flock(f,fcntl.LOCK_EX);b=json.load(f);assert not b['activeCalls'] and b['capUsd']==45
  b['nativeQuotaStopped']=False;f.seek(0);f.truncate();json.dump(b,f,indent=2);f.write('\n')
 env=dict(os.environ,TMPDIR=str(ROOT/'.tmp'))
 for key in ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY']:env.pop(key,None)
 folder=CELL/'cache/native-quota-recovery/answers';folder.mkdir(exist_ok=True)
 def call(r):
  p=folder/(r['phase']+'-'+r['fingerprint']+'.json')
  if p.exists() and read(p).get('verify_answered'):return read(p)
  result=subprocess.run(['python3',str(BASE/'transport-retry.py'),'--model',MODEL,'--system-prompt',r['system']],input=r['user'],text=True,capture_output=True,cwd=ROOT,env=dict(env,VERIFY_PHASE=r['phase']),check=True)
  if result.stderr:
   with (CELL/'logs/native-quota-recovery.stderr.log').open('a') as f:f.write(result.stderr)
  answer=json.loads(result.stdout);p.write_text(json.dumps(answer)+'\n')
  with (CELL/'receipts/native-quota-recovery.jsonl').open('a') as f:f.write(json.dumps(dict(at=now(),phase=r['phase'],fingerprint=r['fingerprint'],receipt=answer.get('verify_receipt_id'),terminal=answer.get('verify_answered',False),isError=answer.get('is_error',False)))+'\n')
  print(json.dumps(dict(phase=r['phase'],terminal=answer.get('verify_answered',False),receipt=answer.get('verify_receipt_id'))),flush=True)
  return answer
 probe=call(requests[0])
 state=dict(at=now(),status='probe answered' if probe.get('verify_answered') else 'probe no answer; stopped',probeReceipt=probe.get('verify_receipt_id'),returnedAnswersResent=0)
 (CELL/'evidence/native-quota-recovery-state.json').write_text(json.dumps(state,indent=2)+'\n')
 if not probe.get('verify_answered'):return
 pending=iter(requests[1:]);done=1;halt=False
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  active={pool.submit(call,r):r for r in [next(pending),next(pending)]}
  while active:
   finished,_=concurrent.futures.wait(active,return_when=concurrent.futures.FIRST_COMPLETED)
   for future in finished:
    r=active.pop(future);answer=future.result();done+=bool(answer.get('verify_answered'))
    if not answer.get('verify_answered'):halt=True
   if not halt:
    while len(active)<2:
     r=next(pending,None)
     if r is None:break
     active[pool.submit(call,r)]=r
 state.update(at=now(),status='complete' if done==len(requests) else 'paused: transport missing',terminalRequests=done,expectedRequests=len(requests))
 (CELL/'evidence/native-quota-recovery-state.json').write_text(json.dumps(state,indent=2)+'\n');print(json.dumps(state),flush=True)
if __name__=='__main__':main()
