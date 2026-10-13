"""Crash recovery: preserve frozen requests, durable results, independent queues."""
import argparse, collections, concurrent.futures, fcntl, signal, threading, time
from common import *
import run as primary
variant=load_module('dialect_resume', HERE/'dialect-run.py')
LOCK=threading.RLock()
STOP=threading.Event()
MODEL_LIMITS={'gpt-6-luna':8,'gemini-3.8-flash':2,'haiku':2}

def dest(experiment):return HERE if experiment=='primary' else HERE/'dialect'
def readlines(path):return [json.loads(s) for s in path.read_text().splitlines()] if path.exists() else []
def measured(a):return (primary.priced(a) if a['model']=='gpt-6-luna' else a.get('measured_usd')) or 0
def model_slot_available(model,inflight):
    return sum(r['model']==model for r in inflight.values())<MODEL_LIMITS[model]

def work(r):
    experiment=r['experiment'];directory=dest(experiment)
    attempt=0;quota_failures=0;transport_failures=0;delay=0
    while True:
        attempt+=1
        if delay:
            with LOCK:primary.append(directory/'recovery-attempts.jsonl',{'event':'backoff','request_sha256':r['request_sha256'],'attempt':attempt,'seconds':delay,'stamp':stamp()})
            time.sleep(delay)
        with LOCK:primary.append(directory/'recovery-attempts.jsonl',{'event':'start','request_sha256':r['request_sha256'],'attempt':attempt,'model':r['model'],'stamp':stamp()})
        a=primary.call_once(r) if experiment=='primary' else variant.attempt(r,attempt)
        a.update(experiment=experiment,attempt_count=attempt,crash_reask=r['crash_reask'])
        quota=(a.get('error') or {}).get('status')==429 and not a.get('provider_response')
        retryable=quota or (primary.transport_retryable(a) if experiment=='primary' else variant.retryable(a))
        with LOCK:
            primary.append(directory/'recovery-attempts.jsonl',{'event':'finish',**a})
        if quota:
            quota_failures+=1
            if quota_failures>3:
                a['quota_pending']=True
                with LOCK:primary.append(directory/'quota-pending.jsonl',a)
                return a
            delay=(60,120,240)[quota_failures-1]
            continue
        if not retryable:break
        transport_failures+=1
        if transport_failures>=3:break
        delay=10 if transport_failures==1 else 30
    a['outcome']=(native.outcome(a['text'],r['side'],r['row']) if experiment=='primary' else variant.outcome(a['text'],r['side'],r['row'])) if a['success'] else 'inconclusive'
    with LOCK:primary.append(directory/'calls.jsonl',a)
    return a

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    primary.verify_seal();variant.verify()
    amendment=json.loads((HERE/'recovery-amendment.json').read_text())
    concurrency=json.loads((HERE/'concurrency-amendment.json').read_text())
    quota=json.loads((HERE/'quota-amendment.json').read_text())
    pacing=json.loads((HERE/'pacing-amendment.json').read_text())
    assert pacing['per_model_limits']==MODEL_LIMITS
    for name,value in (amendment['sha256']|concurrency['sha256']|quota['sha256']|pacing['sha256']).items():assert digest(ROOT/name)==value,name
    committed=primary.subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/recovery-amendment.json'],cwd=ROOT)
    assert committed==(HERE/'recovery-amendment.json').read_bytes()
    committed=primary.subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/concurrency-amendment.json'],cwd=ROOT)
    assert committed==(HERE/'concurrency-amendment.json').read_bytes()
    committed=primary.subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/quota-amendment.json'],cwd=ROOT)
    assert committed==(HERE/'quota-amendment.json').read_bytes()
    committed=primary.subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/pacing-amendment.json'],cwd=ROOT)
    assert committed==(HERE/'pacing-amendment.json').read_bytes()
    recovery=json.loads((HERE/'crash-recovery.json').read_text())
    authorised={r['request_sha256'] for r in recovery['items']}
    locks=[]
    for experiment in ('primary','dialect'):
        f=(dest(experiment)/'runner.lock').open('a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
    queues=collections.defaultdict(collections.deque);spent=0
    for experiment in ('primary','dialect'):
        old=records() if experiment=='primary' else variant.variant_records()
        done={r['request_sha256'] for r in old};spent+=sum(measured(a) for a in old)
        starts=collections.Counter(r['request_sha256'] for r in readlines(dest(experiment)/'starts.jsonl'))
        unknown=set(starts)-done
        assert unknown<=authorised,(experiment,'unauthorized unknown keys',unknown-authorised)
        assert all(starts[k]==1 for k in unknown),'A crash re-ask was already started; do not repeat it'
        reqs=primary.requests(MODELS,None) if experiment=='primary' else variant.all_requests()
        unique={}
        for r in reqs:unique.setdefault(r['request_sha256'],r)
        for key,r in unique.items():
            if key not in done:queues[(experiment,r['model'])].append(dict(r,experiment=experiment,crash_reask=key in authorised))
    print(json.dumps({'pending':{str(k):len(q) for k,q in queues.items()},'measured_usd':spent,'lost_reserve_usd':recovery['lost_attempt_reserve_usd'],'execute':args.execute}),flush=True)
    if not args.execute:return
    primary.ledger('crash recovery start; lost-attempt reserve USD 0.40',0,spent)
    signal.signal(signal.SIGTERM,lambda *_:STOP.set());signal.signal(signal.SIGINT,lambda *_:STOP.set())
    inflight={};fresh=0;stop=None;reserve=recovery['lost_attempt_reserve_usd'];quota_blocked=set()
    queue_order=collections.deque(queues)
    global_limit=sum(MODEL_LIMITS.values())
    with concurrent.futures.ThreadPoolExecutor(max_workers=global_limit) as pool:
        while any(queues.values()) or inflight:
            if (HERE/'recovery-drain').exists():STOP.set();stop='drain requested'
            if datetime.datetime.now(datetime.timezone.utc)>=datetime.datetime.fromisoformat('2026-10-13T20:00:00+00:00'):STOP.set();stop='frozen cutoff'
            for _ in range(len(queue_order)*global_limit):
                if len(inflight)>=global_limit or STOP.is_set():break
                key=queue_order[0];queue_order.rotate(-1);queue=queues[key]
                if key[1] in quota_blocked:continue
                if queue and model_slot_available(key[1],inflight):
                    if spent+reserve+.02*(len(inflight)+1)>10:STOP.set();stop='shared cap with lost-attempt reserve';break
                    r=queue.popleft()
                    with LOCK:primary.append(dest(r['experiment'])/'starts.jsonl',{k:v for k,v in r.items() if k not in ('prompt','built')}|{'started':stamp()})
                    inflight[pool.submit(work,r)]=r
            if not inflight:break
            completed,_=concurrent.futures.wait(inflight,timeout=10,return_when=concurrent.futures.FIRST_COMPLETED)
            for f in completed:
                r=inflight.pop(f);a=f.result();spent+=measured(a)
                if a.get('quota_pending'):
                    queues[(r['experiment'],r['model'])].appendleft(r)
                    quota_blocked.add(r['model']);stop='HTTP 429 quota pending; no judge failure'
                    continue
                fresh+=1
                if fresh%50==0:print(json.dumps({'stamp':stamp(),'fresh_completed':fresh,'remaining':{str(k):len(q) for k,q in queues.items()},'measured_usd':spent,'lost_reserve_usd':reserve,'limits':MODEL_LIMITS}),flush=True)
            dump(HERE/'recovery-state.json',{'stamp':stamp(),'fresh_completed':fresh,'remaining':{str(k):len(q) for k,q in queues.items()},'inflight':len(inflight),'measured_usd':spent,'lost_reserve_usd':reserve,'stop_reason':stop,'global_limit':global_limit,'limits':MODEL_LIMITS})
    primary.ledger('crash recovery finish '+str(stop),fresh,spent)
    print(json.dumps({'finished':stamp(),'fresh_completed':fresh,'measured_usd':spent,'lost_reserve_usd':reserve,'stop_reason':stop}),flush=True)

if __name__=='__main__':main()
