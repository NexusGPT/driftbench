"""Owner-authorized network pacing. Probe only, then resume cached drivers."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import signal
import time
import urllib.error
import urllib.request

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
MODELS=['claude-sonnet-5-5','gpt-6.1-sol']
STATUS=HERE/'results/frontier-supervisor.json'
HOLD=HERE/'results/frontier-network-hold.json'
CONTROL=HERE/'results/frontier-network-control.json'
EVENTS=HERE/'results/frontier-probes.jsonl'
LEDGER=Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/spend-ledger.md')
stops=[];targets={};cycle=0;active_model=None;child=None;stopping=False
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def state(status,**extra):
    STATUS.write_text(json.dumps({'pid':os.getpid(),'status':status,'at':now(),'cycle':cycle,'activeModel':active_model,'targets':targets,'networkStops':stops,**extra},indent=2)+'\n')
def stop(signum,frame):
    global stopping
    stopping=True
    if child is not None and child.poll() is None:child.send_signal(signal.SIGTERM)
    state('draining')
def wait(seconds,status,**extra):
    end=time.time()+seconds;state(status,nextAt=datetime.datetime.fromtimestamp(end,datetime.timezone.utc).isoformat(),**extra)
    while time.time()<end:
        if stopping:raise InterruptedError('Owner stopped supervisor')
        time.sleep(min(5,max(0,end-time.time())))
def probe(url):
    start=now()
    try:
        with urllib.request.urlopen(url,timeout=15) as response:result={'httpStatus':response.status}
    except urllib.error.HTTPError as error:result={'httpStatus':error.code}
    except Exception as error:result={'error':str(error)}
    return {'url':url,'startedAt':start,'finishedAt':now(),'authentication':'none','paidCalls':0,**result}
def healthy_ten(model):
    consecutive=0
    url='https://api.anthropic.com/v1/models' if model=='claude-sonnet-5-5' else 'https://api.openai.com/v1/models'
    while consecutive<10:
        if stopping:raise InterruptedError('Owner stopped supervisor')
        started=time.monotonic();results=[probe(url)]
        passed=results[0].get('httpStatus')==401
        consecutive=consecutive+1 if passed else 0
        with EVENTS.open('a') as out:out.write(json.dumps({'at':now(),'cycle':cycle,'model':model,'consecutive':consecutive,'passed':passed,'probes':results})+'\n')
        state('probing',consecutive=consecutive,required=10,probes=results)
        if consecutive<10:wait(max(0,30-(time.monotonic()-started)),'probe-spacing',consecutive=consecutive,required=10)
def report():
    for name in ['frontier-checks.py','frontier-report.py','frontier-wrapup.py']:
        with (HERE/'runtime'/(name+'.log')).open('a') as log:
            subprocess.run(['python3',str(HERE/name)],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,check=True)
def finalize():
    report()
    with (HERE/'runtime/frontier-finalizer.log').open('a') as log:
        subprocess.run(['python3',str(HERE/'frontier-finalize.py'),json.dumps(targets)],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,check=True)
def main():
    global cycle,active_model,child
    signal.signal(signal.SIGTERM,stop)
    state('starting',stopCondition='Complete both cells or a budget/nontransport/DEV-gate blocker. Network recovery has no stop-count or schedule limit.')
    for model in MODELS:
        active_model=model
        while True:
            report()
            if json.loads((HERE/'cells'/model/'report.json').read_text())['complete']:break
            cycle+=1;healthy_ten(model)
            if stopping:raise InterruptedError('Owner stopped supervisor')
            CONTROL.write_text(json.dumps({'epochStart':now(),'cycle':cycle,'model':model,'supervisorPid':os.getpid(),'probeFile':str(EVENTS),'maxConcurrentCalls':2,'gatePassed':True,'probesRequired':10},indent=2)+'\n')
            if HOLD.exists():HOLD.rename(HERE/'results'/f'frontier-network-hold-before-{os.getpid()}-{cycle}.json')
            env=dict(os.environ)
            if model=='gpt-6.1-sol':env['OPENAI_API_KEY']=(Path.home()/'.nexus-secrets/openai.key').read_text().strip()
            else:env.pop('OPENAI_API_KEY',None)
            with (HERE/'cells'/model/'runtime/run.log').open('a') as log:
                child=subprocess.Popen(['node','--import','tsx',str(HERE/'frontier.ts'),model,'run'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
            del env
            targets[model]=child.pid;state('running')
            while child.poll() is None:time.sleep(5)
            code=child.returncode;child=None;report()
            if stopping:raise InterruptedError('Owner stopped supervisor')
            if json.loads((HERE/'cells'/model/'report.json').read_text())['complete']:break
            current=json.loads((HERE/'cells'/model/'state.json').read_text())
            if HOLD.exists() or current.get('error')=='TRANSPORT_MISSING_PHASE':
                hold=json.loads(HOLD.read_text()) if HOLD.exists() else {'at':now(),'reason':'Transport-missing phase; retry missing-only after a fresh health gate','split':current.get('split')}
                stops.append({'at':hold['at'],'cycle':cycle,'model':model,'split':hold.get('split')})
                with LEDGER.open('a') as out:out.write(f"\n| {now()} | ledger-wp network recovery {cycle}, {model} | Ten-minute pause then ten healthy probes 30 seconds apart; unlimited missing-only cycles, concurrency 2, one cell at a time | {hold['reason']} |\n")
                wait(600,'network-backoff',reason=hold['reason']);continue
            state('blocked',reason=current.get('error','Unclassified driver exit'),exitCode=code)
            finalize();return
    state('complete');finalize()
if __name__=='__main__':
    try:main()
    except InterruptedError as error:state('stopped',reason=str(error))
    except Exception as error:state('failed',error=str(error));raise
