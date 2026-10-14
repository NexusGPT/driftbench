"""Atomic separate budgets and admission limits for the two additional model cells."""
import datetime,fcntl,json,math,os,sys,time
from pathlib import Path

def transact(folder,action,token,amount=0,model='',pid=0):
 b=Path(folder);path=b/'receipts/budget.json';path.parent.mkdir(parents=True,exist_ok=True)
 with path.open('a+') as f:
  fcntl.flock(f,fcntl.LOCK_EX);f.seek(0);raw=f.read();s=json.loads(raw) if raw else dict(capUsd=25,spentUsd=0,reservations={},receipts=[],activeCalls={})
  assert math.isfinite(amount) and amount>=0
  active=s.setdefault('activeCalls',{})
  if action=='try-acquire':
   assert not s.get('nativeQuotaStopped'), 'Native session quota stopped admissions'
   gate_path=Path(__file__).resolve().parent/'evidence/network-admission.json'
   gate=json.loads(gate_path.read_text()) if gate_path.exists() else {}
   if not gate.get('open') or gate.get('model')!=model or time.time()-gate.get('lastProbeEpoch',0)>75:return dict(acquired=False)
   assert not s.get('billingStopped'), 'HTTP 402 stopped new admissions'
   for k,v in list(active.items()):
    try:os.kill(v['pid'],0)
    except ProcessLookupError:del active[k]
   limit=2
   if model=='claude-sonnet-5-5':
    recent=[];p=b/'receipts/errors.jsonl'
    if p.exists():
     for line in p.read_text().splitlines():
      e=json.loads(line)
      if e.get('noAnswer') and time.time()-datetime.datetime.fromisoformat(e['at'].replace('Z','+00:00')).timestamp()<600:recent.append(e['id'])
    load=os.getloadavg()[0];limit=2
    s['pacing']=dict(loadOneMinute=load,recentNoAnswerIds=recent,limit=limit)
   if len(active)>=limit:return dict(acquired=False)
   assert token not in active;active[token]=dict(pid=pid,model=model,at=datetime.datetime.now(datetime.timezone.utc).isoformat())
  elif action=='release':active.pop(token,None)
  elif action=='reserve':
   assert token not in s['reservations'] and token not in {r['id'] for r in s['receipts']}
   assert s['spentUsd']+sum(x['usd'] for x in s['reservations'].values())+amount<=s['capUsd'], 'Budget limit reached'
   s['reservations'][token]=dict(usd=amount,model=model,at=datetime.datetime.now(datetime.timezone.utc).isoformat())
  elif action=='settle':
   r=s['reservations'].pop(token);s['spentUsd']+=amount;s['receipts'].append(dict(id=token,model=model,usd=amount,reservedUsd=r['usd']))
   if amount>r['usd']:s['billingStopped']='Provider charge exceeds reservation; inspection required'
  elif action=='native-quota-stop':s['nativeQuotaStopped']=True
  elif action=='billing-stop':s['billingStopped']='HTTP 402'
  elif action!='status':raise ValueError(action)
  f.seek(0);f.truncate();json.dump(s,f,indent=2);f.write('\n');f.flush()
  return dict(acquired=action=='try-acquire',spentUsd=s['spentUsd'],reservedUsd=sum(x['usd'] for x in s['reservations'].values()),capUsd=s['capUsd'])
if __name__=='__main__':print(json.dumps(transact(sys.argv[1],sys.argv[2],sys.argv[3],float(sys.argv[4]),sys.argv[5],int(sys.argv[6]))))
