"""Read live progress without racing the atomic budget writer. Never starts calls."""
import datetime,fcntl,json,os,time
from pathlib import Path
BASE=Path(__file__).resolve().parent
def read(path):
 with path.open() as stream:
  fcntl.flock(stream,fcntl.LOCK_SH)
  return json.load(stream)
def alive(pid):
 try:os.kill(pid,0);return True
 except ProcessLookupError:return False
def snapshot():
 result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 for model,folder in [('claude-sonnet-5-5','sonnet'),('gpt-6.1-sol','sol61')]:
  b=BASE/folder;p=read(b/f'{model}.progress.json');budget=read(b/'receipts/budget.json');answers=[]
  for line in (b/'receipts/calls.jsonl').read_text().splitlines():
   try:r=json.loads(line)
   except json.JSONDecodeError:
    print(json.dumps({'at':result['at'],'model':model,'transientRead':'Incomplete receipt append; reread on next poll'}),flush=True);continue
   if r.get('output',{}).get('verify_answered'):answers.append(r)
  test=[r for r in answers if r['phase']=='test'];active_path=b/p['phase']/f'{model}.active.json';active=read(active_path) if active_path.exists() else None
  result[model]=dict(phase=p['phase'],status=p['status'],testAnswerEnvelopes=len(test),allPhaseAnswerEnvelopes=len(answers),lastAnswerAt=answers[-1]['at'] if answers else None,settled=round(budget['spentUsd'],6),held=round(sum(v['usd'] for v in budget['reservations'].values()),6),active=len(budget['activeCalls']),quotaStopped=budget.get('nativeQuotaStopped',False),runnerPid=active['pid'] if active else None,runnerAlive=alive(active['pid']) if active else None,finalized=(b/'evidence/finalizer-state.json').exists())
 return result
def main():
 for _ in range(720):
  try:
   print(json.dumps(snapshot()),flush=True)
   p=BASE/'evidence/new-model-publication-driver.json'
   if p.exists() and read(p)['status']=='published and remote verified':return
  except (json.JSONDecodeError,OSError) as error:
   print(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'readError':str(error),'retryNextPoll':True}),flush=True)
  time.sleep(30)
if __name__=='__main__':main()
