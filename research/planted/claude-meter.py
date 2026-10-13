#!/usr/bin/env python3
"""Transport-only spend and concurrency guard. Does not change judge prompts."""
import fcntl, json, os, subprocess, sys, time, uuid
from pathlib import Path

root=Path(__file__).parent
runtime=root/'runtime';runtime.mkdir(exist_ok=True)
statefile=runtime/'meter-state.json';lockfile=runtime/'meter.lock'
RESERVE=0.25
CAP=16.0
token=str(uuid.uuid4())

def update(fn):
    with lockfile.open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        state=json.loads(statefile.read_text()) if statefile.exists() else {'spent':0.0,'unknownReserved':0.0,'active':{},'calls':0,'peak':0}
        result=fn(state)
        statefile.write_text(json.dumps(state,indent=2)+'\n')
        return result

def reserve(s):
    if time.time()>=1791866100: raise RuntimeError('Last new call limit reached: 06:35 Brussels')
    if len(s['active'])>=6: raise RuntimeError('Global model concurrency exceeds six')
    if s['spent']+s['unknownReserved']+sum(s['active'].values())+RESERVE>CAP:
        raise RuntimeError('Task spend limit reached with in-flight reserve')
    s['active'][token]=RESERVE;s['peak']=max(s['peak'],len(s['active']))
try:update(reserve)
except Exception as e:
    print(json.dumps({'is_error':True,'result':str(e),'total_cost_usd':0}));sys.exit(1)
args=sys.argv[1:]
if '--model' not in args or args[args.index('--model')+1]!='haiku':raise RuntimeError('haiku only')
if '--max-budget-usd' in args:args[args.index('--max-budget-usd')+1]='0.10'
else:args+=['--max-budget-usd','0.10']
started=time.time();payload=None;stdout='';stderr='';exitcode=1
try:
    run=subprocess.run(['claude',*args],input=sys.stdin.read(),capture_output=True,text=True,timeout=180)
    stdout=run.stdout;stderr=run.stderr;exitcode=run.returncode
    try:payload=json.loads(stdout)
    except json.JSONDecodeError:pass
except subprocess.TimeoutExpired:
    stderr='Owned model process timed out at 180 seconds; full reservation retained.'
finally:
    cost=payload.get('total_cost_usd') if isinstance(payload,dict) else None
    known=isinstance(cost,(int,float)) and cost>=0
    def finish(s):
        s['active'].pop(token,None);s['calls']+=1
        if known:s['spent']+=cost
        else:s['unknownReserved']+=RESERVE
    update(finish)
    with (runtime/'spend.jsonl').open('a') as f:
        f.write(json.dumps({'token':token,'startedAt':started,'endedAt':time.time(),'costUsd':cost if known else None,'unknownReservation':0 if known else RESERVE,'exitCode':exitcode,'isError':payload.get('is_error') if isinstance(payload,dict) else True,'models':list(payload.get('modelUsage',{})) if isinstance(payload,dict) else []})+'\n')
if stdout:sys.stdout.write(stdout)
else:print(json.dumps({'is_error':True,'result':stderr or 'Transport returned no JSON','total_cost_usd':cost if known else 0}))
if stderr:sys.stderr.write(stderr)
sys.exit(exitcode)
