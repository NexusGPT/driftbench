"""Watch only these two owned drivers, audit their artifacts, push once, then exit."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
TARGETS=json.loads(sys.argv[1])
STATUS=HERE/'runtime/frontier-finalizer.json'
LEDGER=Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/spend-ledger.md')
def state(status,**extra):
    STATUS.write_text(json.dumps({'pid':os.getpid(),'targets':TARGETS,'status':status,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),**extra},indent=2)+'\n')
def run(args):
    r=subprocess.run(args,cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    print(r.stdout,flush=True);r.check_returncode();return r.stdout.strip()
def main():
    state('watching',stopCondition='Both named drivers exit; audit and push their terminal artifacts once; never start paid calls.')
    while True:
        alive=[]
        for model,pid in TARGETS.items():
            current=json.loads((HERE/'cells'/model/'state.json').read_text())
            if current['pid']!=pid:raise RuntimeError('Named driver replaced: '+model)
            probe=subprocess.run(['ps','-p',str(pid),'-o','command='],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            if probe.returncode not in (0,1):raise RuntimeError(probe.stdout)
            if probe.returncode==0 and 'frontier.ts' in probe.stdout:alive.append(model)
        if not alive:break
        time.sleep(25)
    state('finalizing')
    if run(['git','branch','--show-current'])!='research/ledger-wp':raise RuntimeError('Wrong branch')
    run(['node','--import','tsx',str(HERE/'frontier.test.ts')])
    run(['python3',str(HERE/'frontier-checks.py')])
    run(['python3',str(HERE/'frontier-report.py')])
    audits={}
    for model in TARGETS:
        report=json.loads((HERE/'cells'/model/'report.json').read_text())
        if report['complete']:
            run(['node','--import','tsx',str(HERE/'frontier-audit.ts'),model])
            audits[model]=json.loads((HERE/'cells'/model/'audit.json').read_text())
        else:audits[model]={'passed':False,'reason':'Incomplete sealed cell','spend':report['spend']}
    run(['python3',str(HERE/'frontier-wrapup.py')])
    with LEDGER.open('a') as out:
        out.write(f"\n| {datetime.datetime.now(datetime.timezone.utc).isoformat()} | ledger-wp additive terminal audit | {json.dumps(audits)} | No paid calls; old 35 USD cap and holds unchanged |\n")
    run(['git','status','--short','examples/ledger-wp'])
    run(['git','add','examples/ledger-wp'])
    paths=run(['git','diff','--cached','--name-only'])
    if any(not x.startswith('examples/ledger-wp/') for x in paths.splitlines()):raise RuntimeError('Out-of-scope staged path')
    run(['git','diff','--cached','--check'])
    if paths:run(['git','commit','-m','Record and audit additive Sonnet and GPT-6.1 writing cells'])
    head=run(['git','rev-parse','HEAD'])
    state('committed',commit=head,audits=audits,push='Deferred until link is healthy, per owner amendment')
if __name__=='__main__':
    try:main()
    except Exception as e:state('failed',error=str(e));raise
