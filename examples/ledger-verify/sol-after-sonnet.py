"""Start the authorized Sol cell only after Sonnet's complete offline evidence is present."""
import datetime,json,os,subprocess,time
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[1]
def read(p):return json.loads(p.read_text())
def main():
 cutoff=time.time()+12*3600
 while time.time()<cutoff:
  p=BASE/'sonnet/evidence/finalizer-state.json'
  if p.exists() and read(p).get('complete') and read(p).get('status')=='offline evidence ready for review':break
  time.sleep(15)
 else:raise RuntimeError('Sonnet completion watcher deadline; no Sol calls started')
 assert not read(BASE/'sonnet/receipts/budget.json')['activeCalls']
 assert read(BASE/'sol61/receipts/budget.json')['capUsd']==40
 control=BASE/'evidence/network-control.json';v=read(control);v.update(model='gpt-6.1-sol',stop=False,at=datetime.datetime.now(datetime.timezone.utc).isoformat(),reason='Owner authorizes Sol cap 40 USD after Sonnet complete');control.write_text(json.dumps(v,indent=2)+'\n')
 env=dict(os.environ,TMPDIR=str(ROOT/'.tmp'))
 for k in ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY']:env.pop(k,None)
 with (BASE/'sol61/logs/cap40-supervisor.log').open('w') as log:
  result=subprocess.run(['python3',str(BASE/'new-cell-supervise.py'),'gpt-6.1-sol'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
 print(json.dumps(dict(exitCode=result.returncode,finished=datetime.datetime.now(datetime.timezone.utc).isoformat())),flush=True)
if __name__=='__main__':main()
