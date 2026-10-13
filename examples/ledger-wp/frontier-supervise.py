"""Owner-authorized network pacing. Probe only, then resume cached drivers."""
import concurrent.futures
import datetime
import json
import os
from pathlib import Path
import subprocess
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
CUTOFF=datetime.datetime.fromisoformat('2026-10-13T16:00:00+00:00').timestamp()
stops=[];targets={};cycle=0
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def state(status,**extra):
    STATUS.write_text(json.dumps({'pid':os.getpid(),'status':status,'at':now(),'cycle':cycle,'targets':targets,'networkStops':stops,**extra},indent=2)+'\n')
def wait(seconds,status,**extra):
    end=time.time()+seconds;state(status,nextAt=datetime.datetime.fromtimestamp(end,datetime.timezone.utc).isoformat(),**extra)
    while time.time()<end:
        if time.time()>=CUTOFF:raise RuntimeError('Last-call cutoff reached')
        time.sleep(min(5,max(0,end-time.time())))
def probe(url):
    start=now()
    try:
        with urllib.request.urlopen(url,timeout=15) as response:result={'httpStatus':response.status}
    except urllib.error.HTTPError as error:result={'httpStatus':error.code}
    except Exception as error:result={'error':str(error)}
    return {'url':url,'startedAt':start,'finishedAt':now(),'authentication':'none','paidCalls':0,**result}
def healthy_three():
    consecutive=0
    while consecutive<3:
        if time.time()>=CUTOFF:raise RuntimeError('Last-call cutoff reached')
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(probe,['https://api.anthropic.com/v1/models','https://api.openai.com/v1/models']))
        passed=all(r.get('httpStatus')==401 for r in results)
        consecutive=consecutive+1 if passed else 0
        with EVENTS.open('a') as out:out.write(json.dumps({'at':now(),'cycle':cycle,'consecutive':consecutive,'passed':passed,'probes':results})+'\n')
        state('probing',consecutive=consecutive,probes=results)
        if consecutive<3:wait(60,'probe-spacing',consecutive=consecutive)
def report():
    for name in ['frontier-checks.py','frontier-report.py']:
        with (HERE/'runtime'/(name+'.log')).open('a') as log:
            subprocess.run(['python3',str(HERE/name)],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,check=True)
def finalize():
    report()
    with (HERE/'runtime/frontier-finalizer.log').open('a') as log:
        subprocess.run(['python3',str(HERE/'frontier-finalize.py'),json.dumps(targets)],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,check=True)
def main():
    global cycle,targets
    state('starting',stopCondition='Complete both cells, reach budget/cutoff, or three new network stops in one hour. Any mid-TEST network break requires owner word before TEST retry.')
    while True:
        cycle+=1
        healthy_three()
        CONTROL.write_text(json.dumps({'epochStart':now(),'cycle':cycle,'supervisorPid':os.getpid(),'probeFile':str(EVENTS),'maxConcurrentCalls':2},indent=2)+'\n')
        if HOLD.exists():HOLD.rename(HERE/'results'/f'frontier-network-hold-before-cycle-{cycle}.json')
        env=dict(os.environ);env['OPENAI_API_KEY']=(Path.home()/'.nexus-secrets/openai.key').read_text().strip()
        children={}
        for model in MODELS:
            with (HERE/'cells'/model/'runtime/run.log').open('a') as log:
                children[model]=subprocess.Popen(['node','--import','tsx',str(HERE/'frontier.ts'),model,'run'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
        del env
        targets={m:c.pid for m,c in children.items()};state('running')
        while any(child.poll() is None for child in children.values()):time.sleep(5)
        codes={m:c.returncode for m,c in children.items()};report()
        if HOLD.exists():
            hold=json.loads(HOLD.read_text());stops.append({'at':hold['at'],'cycle':cycle,'split':hold['split']})
            recent=[s for s in stops if time.time()-datetime.datetime.fromisoformat(s['at']).timestamp()<3600]
            with LEDGER.open('a') as out:out.write(f"\n| {now()} | ledger-wp network stop cycle {cycle} | {len(recent)} stops in one hour under new pacing; no paid calls until three spaced probes pass. Answers and holds retained. | {hold['reason']} |\n")
            if hold['split']=='test' or len(recent)>=3:
                state('parked',reason='Mid-TEST network break' if hold['split']=='test' else 'Three network stops in one hour',exitCodes=codes)
                finalize();return
            wait(600,'network-backoff',reason=hold['reason']);continue
        if all(code==0 for code in codes.values()):
            state('complete');finalize();return
        state('parked',reason='Budget, cutoff, health gate or non-network driver failure',exitCodes=codes);finalize();return
if __name__=='__main__':
    try:main()
    except Exception as error:state('failed',error=str(error));raise
