"""Crash recovery: preserve frozen requests, durable results, independent queues."""
import argparse, collections, concurrent.futures, fcntl, signal, threading, time
from common import *
import run as primary
variant=load_module('dialect_resume', HERE/'dialect-run.py')
LOCK=threading.RLock()
STOP=threading.Event()
MODEL_LIMITS={'gpt-6-luna':8,'gemini-3.8-flash':2,'haiku':2}
PROVIDER_HOLDS=set()

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
        if r['model'] in PROVIDER_HOLDS:
            return dict(r,billing_pending=True,hold_without_dispatch=True,success=False,measured_usd=0)
        with LOCK:primary.append(directory/'recovery-attempts.jsonl',{'event':'start','request_sha256':r['request_sha256'],'attempt':attempt,'model':r['model'],'stamp':stamp()})
        a=primary.call_once(r) if experiment=='primary' else variant.attempt(r,attempt)
        a.update(experiment=experiment,attempt_count=attempt,crash_reask=r['crash_reask'])
        quota=(a.get('error') or {}).get('status')==429 and not a.get('provider_response')
        retryable=quota or (primary.transport_retryable(a) if experiment=='primary' else variant.retryable(a))
        with LOCK:
            primary.append(directory/'recovery-attempts.jsonl',{'event':'finish',**a})
            if (a.get('error') or {}).get('status')==402 and not a.get('provider_response') and not a.get('text'):
                PROVIDER_HOLDS.add(r['model'])
                dump(HERE/'provider-holds.json',{'stamp':stamp(),'models':sorted(PROVIDER_HOLDS),'reason':'HTTP 402 prepaid credits depleted; owner top-up required'})
                a['billing_pending']=True
                a['proven_rejection']=True
                primary.append(directory/'billing-rejections.jsonl',a)
                return a
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

def hold_after_reset(hold,now):
    result=dict(hold)
    if hold.get('requires_owner_resume'):
        result['models']=sorted(set(hold['models'])|{'gemini-3.8-flash'})
        return result
    if hold.get('resume_not_before') and now>=datetime.datetime.fromisoformat(hold['resume_not_before']):
        result['models']=[m for m in hold['models'] if m!='gemini-3.8-flash']
        result.update(stamp=now.isoformat(),reason='Daily quota reset reached; missing-only resumption authorized')
    return result

def deadline_for(model,daily):
    return daily['gemini_missing_only_cutoff'] if model=='gemini-3.8-flash' else '2026-10-13T20:00:00+00:00'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    primary.verify_seal();variant.verify()
    amendment=json.loads((HERE/'recovery-amendment.json').read_text())
    concurrency=json.loads((HERE/'concurrency-amendment.json').read_text())
    quota=json.loads((HERE/'quota-amendment.json').read_text())
    pacing=json.loads((HERE/'pacing-amendment.json').read_text())
    billing=json.loads((HERE/'billing-amendment.json').read_text())
    topup=json.loads((HERE/'topup-runtime-amendment.json').read_text())
    budget=json.loads((HERE/'budget-amendment.json').read_text())
    daily=json.loads((HERE/'daily-quota-amendment.json').read_text())
    owner_hold=json.loads((HERE/'owner-hold-amendment.json').read_text())
    assert pacing['per_model_limits']==MODEL_LIMITS
    for name,value in (amendment['sha256']|concurrency['sha256']|quota['sha256']|pacing['sha256']|billing['sha256']|topup['sha256']|budget['sha256']|daily['sha256']|owner_hold['sha256']).items():assert digest(ROOT/name)==value,name
    committed=primary.subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/recovery-amendment.json'],cwd=ROOT)
    assert committed==(HERE/'recovery-amendment.json').read_bytes()
    committed=primary.subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/concurrency-amendment.json'],cwd=ROOT)
    assert committed==(HERE/'concurrency-amendment.json').read_bytes()
    committed=primary.subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/quota-amendment.json'],cwd=ROOT)
    assert committed==(HERE/'quota-amendment.json').read_bytes()
    committed=primary.subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/pacing-amendment.json'],cwd=ROOT)
    assert committed==(HERE/'pacing-amendment.json').read_bytes()
    committed=primary.subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/billing-amendment.json'],cwd=ROOT)
    assert committed==(HERE/'billing-amendment.json').read_bytes()
    committed=primary.subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/topup-runtime-amendment.json'],cwd=ROOT)
    assert committed==(HERE/'topup-runtime-amendment.json').read_bytes()
    committed=primary.subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/budget-amendment.json'],cwd=ROOT)
    assert committed==(HERE/'budget-amendment.json').read_bytes()
    committed=primary.subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/daily-quota-amendment.json'],cwd=ROOT)
    assert committed==(HERE/'daily-quota-amendment.json').read_bytes()
    committed=primary.subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/owner-hold-amendment.json'],cwd=ROOT)
    assert committed==(HERE/'owner-hold-amendment.json').read_bytes()
    hold=json.loads((HERE/'provider-holds.json').read_text())
    released=hold_after_reset(hold,datetime.datetime.now(datetime.timezone.utc))
    if args.execute and released!=hold:dump(HERE/'provider-holds.json',released)
    hold=released
    PROVIDER_HOLDS.update(hold['models'])
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
        rejections=collections.Counter(a['request_sha256'] for a in readlines(dest(experiment)/'billing-rejections.jsonl'))
        quota_pending=collections.Counter(a['request_sha256'] for a in readlines(dest(experiment)/'quota-pending.jsonl'))
        rejections.update(quota_pending)
        rejected=set(rejections)
        assert unknown<=authorised|rejected,(experiment,'unauthorized unknown keys',unknown-authorised-rejected)
        assert all(starts[k]==1 for k in unknown-rejected),'A crash re-ask was already started; do not repeat it'
        assert all(starts[k]==rejections[k]+(1 if k in authorised else 0) for k in unknown&rejected),'Unproven attempt after a proven no-answer rejection'
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
            for _ in range(len(queue_order)*global_limit):
                if len(inflight)>=global_limit or STOP.is_set():break
                key=queue_order[0];queue_order.rotate(-1);queue=queues[key]
                if key[1] in quota_blocked or key[1] in PROVIDER_HOLDS:continue
                cutoff=deadline_for(key[1],daily)
                if datetime.datetime.now(datetime.timezone.utc)>=datetime.datetime.fromisoformat(cutoff):continue
                if queue and model_slot_available(key[1],inflight):
                    if spent+reserve+.02*(len(inflight)+1)>budget['cap_usd']:STOP.set();stop='shared cap with lost-attempt reserve';break
                    r=queue.popleft()
                    with LOCK:primary.append(dest(r['experiment'])/'starts.jsonl',{k:v for k,v in r.items() if k not in ('prompt','built')}|{'started':stamp()})
                    inflight[pool.submit(work,r)]=r
            if not inflight:
                if stop is None and any(q and k[1] in PROVIDER_HOLDS for k,q in queues.items()):
                    stop='Gemini daily quota pending; 262 requests not run' if hold.get('resume_not_before') else 'provider billing pending; owner top-up required'
                if stop is None and any(queues.values()):stop='frozen cutoff'
                break
            completed,_=concurrent.futures.wait(inflight,timeout=10,return_when=concurrent.futures.FIRST_COMPLETED)
            for f in completed:
                r=inflight.pop(f);a=f.result();spent+=measured(a)
                if a.get('billing_pending'):
                    queues[(r['experiment'],r['model'])].appendleft(r)
                    continue
                if a.get('quota_pending'):
                    queues[(r['experiment'],r['model'])].appendleft(r)
                    quota_blocked.add(r['model']);stop='HTTP 429 quota pending; no judge failure'
                    continue
                fresh+=1
                if fresh%50==0:print(json.dumps({'stamp':stamp(),'fresh_completed':fresh,'remaining':{str(k):len(q) for k,q in queues.items()},'measured_usd':spent,'lost_reserve_usd':reserve,'limits':MODEL_LIMITS}),flush=True)
            dump(HERE/'recovery-state.json',{'stamp':stamp(),'fresh_completed':fresh,'remaining':{str(k):len(q) for k,q in queues.items()},'inflight':len(inflight),'measured_usd':spent,'lost_reserve_usd':reserve,'stop_reason':stop,'global_limit':global_limit,'limits':MODEL_LIMITS})
    dump(HERE/'recovery-state.json',{'stamp':stamp(),'fresh_completed':fresh,'remaining':{str(k):len(q) for k,q in queues.items()},'inflight':0,'measured_usd':spent,'lost_reserve_usd':reserve,'stop_reason':stop,'global_limit':global_limit,'limits':MODEL_LIMITS,'provider_holds':sorted(PROVIDER_HOLDS)})
    primary.ledger('crash recovery finish '+str(stop),fresh,spent)
    print(json.dumps({'finished':stamp(),'fresh_completed':fresh,'measured_usd':spent,'lost_reserve_usd':reserve,'stop_reason':stop}),flush=True)

if __name__=='__main__':main()
