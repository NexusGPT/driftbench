"""Publish the authorized cell reports only after both offline finalizers pass."""
import datetime,json,os,subprocess,time
from pathlib import Path
BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[1]
STATE=BASE/'evidence/new-model-publication-driver.json'
def read(p):return json.loads(p.read_text())
def state(status,**details):
 value=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),pid=os.getpid(),status=status,**details)
 STATE.write_text(json.dumps(value,indent=2)+'\n');print(json.dumps(value),flush=True)
def main():
 state('waiting for Sonnet and Sol offline finalizers',deadlineHours=12)
 deadline=time.time()+12*3600
 while time.time()<deadline:
  finals=[BASE/folder/'evidence/finalizer-state.json' for folder in ['sonnet','sol61']]
  if all(p.exists() and read(p).get('complete') and read(p).get('status')=='offline evidence ready for review' for p in finals):break
  time.sleep(30)
 else:
  state('deadline reached; reports not published');return
 for folder,cap in [('sonnet',45),('sol61',40)]:
  budget=read(BASE/folder/'receipts/budget.json')
  assert not budget['activeCalls'],folder
  assert budget['spentUsd']+sum(x['usd'] for x in budget['reservations'].values())<=cap,folder
  assert not read(BASE/folder/'evidence/transport-completeness.json')['unresolved'],folder
 control=BASE/'evidence/network-control.json';value=read(control);value['stop']=True;value['reason']='Both authorized new cells have complete offline evidence';control.write_text(json.dumps(value,indent=2)+'\n')
 state('publishing complete cell evidence')
 for script in ['merge-new-cell-reports.py','publish_results.py']:
  subprocess.run(['python3',str(BASE/script)],cwd=ROOT,check=True)
 head=subprocess.run(['git','rev-parse','HEAD'],cwd=ROOT,text=True,capture_output=True,check=True).stdout.strip()
 state('published and remote verified',head=head,providerCalls=0)
if __name__=='__main__':main()
