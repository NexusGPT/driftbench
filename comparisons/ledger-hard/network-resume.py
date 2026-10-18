"""Owner-authorized serial recovery with unbilled provider probe gates."""
import collections,concurrent.futures,fcntl,os,signal,subprocess,threading,time
from common import *
r=load_module('network_runtime_base',HERE/'extended-run.py')
health=load_module('provider_network_probe',HERE/'network-probe.py')
STOP=threading.Event()

def session_no_answer(answer):
    raw=answer.get('provider_response') or answer.get('cli_error_response') or {}
    usage=raw.get('usage') or {}
    if not raw.get('is_error') or any(usage.get(k,0) for k in ('input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens')):return False
    message=str(raw.get('result',''))+' '+str(raw.get('errors',''))
    return any(term in message.lower() for term in ('rate limit','rate_limit','usage limit','usage_limit','session limit','hit your limit','overloaded'))

def normalize_session_limit(answer):
    if session_no_answer(answer):
        raw=answer.pop('provider_response',None)
        if raw is not None:answer['cli_error_response']=raw
        answer.update(success=False,text='',error={'type':'SessionLimitError','message':str(answer['cli_error_response'].get('result',''))})
        answer.pop('integrity_stop',None)
        # The envelope is not a provider billing receipt; unknown holds remain.
        answer.setdefault('unreported_cost_reserve_usd',.10)
    return answer

def has_answer(a):
    raw=a.get('provider_response')
    return bool(raw) and not session_no_answer(a) and not r.cli_no_answer(raw) and not (raw.get('status')=='failed' and not raw.get('output') and not (raw.get('usage') or {}).get('output_tokens',0))

def transport_no_answer(a):
    return r.connection_failure(a) or (a.get('error') or {}).get('type')=='SessionLimitError' or r.cli_no_answer(a.get('provider_response') or {}) or (not a.get('provider_response') and (a.get('error') or {}).get('status') in (400,401,402,403,404,408,429,500,502,503,504,529))

def within_cap(measured,held,inflight,reserve,cap):return measured+held+(inflight+1)*reserve<=cap

def recover_answer_receipts(cell):
    dest=HERE/cell;existing=r.answers(dest);seen={a['request_sha256'] for a in existing};receipts={}
    assert len(seen)==len(existing)
    for event in r.lines(dest/'attempts.jsonl'):
        if event['event']!='finish' or not has_answer(event):continue
        key=event['request_sha256'];assert key not in receipts,'Multiple answered receipts for one request'
        receipts[key]=event
    for key,event in receipts.items():
        if key in seen:continue
        answer={k:v for k,v in event.items() if k not in ('event','runtime')}
        decode=r.native.outcome if answer['experiment']=='primary' else r.variant.outcome
        answer['outcome']=decode(answer['text'],answer['side'],answer['row']) if answer['success'] else 'inconclusive'
        answer['item_lost']=not answer['success'] or answer['outcome']=='inconclusive'
        answer['recovered_from_durable_attempt_receipt']=True
        r.append(dest/answer['experiment']/'calls.jsonl',answer);seen.add(key)
    assert not any(a.get('integrity_stop') for a in receipts.values()),'Recorded model identity or token integrity defect'

class Circuit:
    def __init__(self):self.streak=0;self.tripped=False
    def observe(self,answer):
        self.streak=self.streak+1 if r.connection_failure(answer) else 0
        self.tripped=self.tripped or self.streak>=3
        return self.tripped

def withdraw_transport(cell):
    dest=HERE/cell;removed=[]
    for experiment in ('primary','dialect'):
        path=dest/experiment/'calls.jsonl'
        if not path.exists():continue
        lines=path.read_text().splitlines(keepends=True);keep=[]
        for line in lines:
            answer=json.loads(line)
            if has_answer(answer):keep.append(line)
            elif transport_no_answer(answer):
                with (dest/'transport-answer-reclassification.jsonl').open('a') as output:
                    output.write(line);output.flush();os.fsync(output.fileno())
                removed.append({'experiment':experiment,'request_sha256':answer['request_sha256'],'reason':'No provider/model answer; eligible for missing-only recovery under network amendment'})
            else:raise AssertionError('Unclassified missing provider receipt requires inspection; do not resend')
        if len(keep)!=len(lines):path.write_text(''.join(keep))
    if removed:r.append(dest/'transport-reclassification-events.jsonl',{'stamp':stamp(),'removed':removed,'answers_deleted':0})
    return removed

def interrupted_wait(seconds):
    end=time.monotonic()+seconds
    while not STOP.is_set() and time.monotonic()<end:
        if (HERE/'network-hold').exists():STOP.set();break
        STOP.wait(min(5,max(0,end-time.monotonic())))
    return STOP.is_set()

def gate(cell,state):
    healthy=0
    while healthy<10 and not STOP.is_set():
        receipt=health.probe(cell);healthy=healthy+1 if receipt['healthy'] else 0
        receipt['consecutive_healthy']=healthy;r.append(HERE/cell/'network-probes.jsonl',receipt)
        state('probe gate',healthy_probes=healthy)
        if healthy<10:interrupted_wait(30)
    return healthy==10

def verify_runtime():
    path=HERE/'network-amendment.json'
    assert subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/network-amendment.json'],cwd=ROOT)==path.read_bytes()
    policy=json.loads(path.read_text())
    for name,h in policy['source_sha256'].items():assert digest(HERE/name)==h,name
    return policy

def run_cell(cell):
    r.verify(cell);dest=HERE/cell;recover_answer_receipts(cell);withdraw_transport(cell);d=r.Driver(cell)
    if cell=='sonnet-5-5':d.cache_disabled=json.loads((dest/'cache-choice.json').read_text())['disable_prompt_caching']
    requests=r.ordered_unique(dest);planned={x['request_sha256'] for x in requests};answers=r.answers(dest);seen={x['request_sha256'] for x in answers}
    assert len(seen)==len(answers)
    events=r.lines(dest/'attempts.jsonl');starts=collections.Counter();finishes=collections.Counter();numbers=collections.Counter()
    for e in events:
        if e['event']=='start':starts[e['request_sha256'],e['attempt']]+=1
        elif e['event']=='finish':finishes[e['request_sha256'],e['attempt']]+=1;numbers[e['request_sha256']]=max(numbers[e['request_sha256']],e['attempt'])
    assert starts==finishes,'Unsettled started attempt requires reconciliation before any resend'
    assert all(v==1 for v in starts.values())
    unit_starts={x['request_sha256'] for x in r.lines(dest/'starts.jsonl')};cap=r.cell_cap(dest);reserve=d.cfg['reserve']
    def state(phase,**extra):
        measured,held=d.totals()
        r.dump(dest/'run-state.json',{'stamp':stamp(),'model':d.cfg['model'],'completed':len(seen),'planned':len(planned),'inflight':extra.pop('inflight',0),'measured_usd':measured,'unknown_attempt_reserve_usd':held,'phase':phase,'concurrency':2,'score_status':'eligible only when all requests have model answers','stop_reason':extra.pop('stop_reason',None),**extra})
    def attempt(request):
        key=request['request_sha256']
        with d.lock:
            numbers[key]+=1;number=numbers[key]
            if key not in unit_starts:
                r.append(dest/'starts.jsonl',{k:v for k,v in request.items() if k!='body'}|{'started':stamp()});unit_starts.add(key)
            r.append(dest/'attempts.jsonl',{'event':'start','request_sha256':key,'attempt':number,'stamp':stamp(),'runtime':'network-amendment'})
        answer=normalize_session_limit(d.attempt(request,number))
        with d.lock:
            r.append(dest/'attempts.jsonl',{'event':'finish',**answer,'runtime':'network-amendment'})
            d.measured+=answer.get('measured_usd') or 0;d.reserved+=answer.get('unreported_cost_reserve_usd',0)
            if has_answer(answer):
                decode=r.native.outcome if request['experiment']=='primary' else r.variant.outcome
                answer['outcome']=decode(answer['text'],request['side'],request['row']) if answer['success'] else 'inconclusive'
                answer['item_lost']=not answer['success'] or answer['outcome']=='inconclusive'
                r.append(dest/request['experiment']/'calls.jsonl',answer)
        return answer
    with (dest/'runner.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        pause_seconds=0;cycles=0;permanent=None;last_projection=len(seen)
        while seen!=planned and not STOP.is_set():
            if pause_seconds:
                state('network pause',pause_seconds=pause_seconds,recovery_cycle=cycles)
                if interrupted_wait(pause_seconds):break
            if not gate(cell,state):break
            queue=collections.deque(x for x in requests if x['request_sha256'] not in seen)
            active={};circuit=Circuit();tripped=False;retry_at=0
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                while queue or active:
                    if (HERE/'network-hold').exists():STOP.set()
                    if datetime.datetime.now(datetime.timezone.utc)>=datetime.datetime.fromisoformat(json.loads((dest/'seal.json').read_text())['last_call_cutoff']):permanent='sealed cutoff';STOP.set()
                    measured,held=d.totals()
                    while queue and len(active)<2 and not STOP.is_set() and not tripped and permanent is None and time.monotonic()>=retry_at:
                        if not within_cap(measured,held,len(active),reserve,cap):
                            if not active:permanent='cap including unknown holds'
                            break
                        request=queue.popleft();active[pool.submit(attempt,request)]=request
                    if not active:
                        if tripped or permanent or STOP.is_set():break
                        interrupted_wait(min(5,max(0,retry_at-time.monotonic())));continue
                    done,_=concurrent.futures.wait(active,timeout=5,return_when=concurrent.futures.FIRST_COMPLETED)
                    # Durable finish order, not arbitrary Future set order, defines the circuit.
                    completed=sorted(((future.result(),future) for future in done),key=lambda pair:pair[0]['finished'])
                    for answer,future in completed:
                        request=active.pop(future);key=request['request_sha256']
                        session_limit=(answer.get('error') or {}).get('type')=='SessionLimitError'
                        if (circuit.observe(answer) or session_limit) and not tripped:
                            tripped=True;r.append(dest/'network-circuits.jsonl',{'stamp':stamp(),'reason':'provider session limit' if session_limit else 'three consecutive connection-class failures','key':key,'pause_seconds':600,'probe_count':10,'probe_spacing_seconds':30})
                        if has_answer(answer):
                            assert key not in seen;seen.add(key)
                            if answer.get('integrity_stop'):permanent='model identity or output-token integrity defect'
                        else:
                            queue.appendleft(request);status=(answer.get('error') or {}).get('status')
                            r.append(dest/'transport-pending.jsonl',{'stamp':stamp(),'request_sha256':key,'attempt':answer['attempt'],'error':answer.get('error'),'eligible_missing_only':True})
                            if status in (400,401,402,403,404):permanent='provider rejection '+str(status)
                            elif not transport_no_answer(answer):permanent='unclassified missing provider receipt'
                            delay=(20,60,180)[min(answer['attempt']-1,2)] if status==429 else 10 if answer['attempt']==1 else 30
                            retry_at=max(retry_at,time.monotonic()+delay)
                            r.append(dest/'attempts.jsonl',{'event':'backoff','request_sha256':key,'attempt':answer['attempt']+1,'seconds':delay,'stamp':stamp(),'runtime':'network-amendment'})
                    if len(seen)-last_projection>=100:
                        projection=r.forecast(dest);last_projection=len(seen)
                        if projection['projected_usd']+d.totals()[1]>cap:permanent='projected cost including holds exceeds cap'
                    state('draining' if tripped or permanent or STOP.is_set() else 'running',inflight=len(active),stop_reason=permanent)
                # The executor exits only after every submitted call has a durable finish.
            if permanent:state('parked',stop_reason=permanent);break
            if tripped:cycles+=1;pause_seconds=600
            elif seen==planned:break
        complete=seen==planned
        state('complete' if complete else 'parked',stop_reason=permanent or ('operator hold' if STOP.is_set() else None))
        with r.primary.LEDGER.open('a') as output:output.write(f'\n| {stamp()} | ledger-hard {cell} network recovery | {len(seen)}/{len(planned)} answered | {d.totals()[0]:.8f} USD; {d.totals()[1]:.8f} reserve | cap {cap}; no score while missing; {"complete" if complete else permanent or "operator hold"} |\n')
        return complete

def main():
    policy=verify_runtime()
    signal.signal(signal.SIGTERM,lambda *_:STOP.set());signal.signal(signal.SIGINT,lambda *_:STOP.set())
    with (HERE/'network-runner.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        r.dump(HERE/'network-process.json',{'pid':os.getpid(),'started':stamp(),'order':policy['model_order'],'stop_file':'comparisons/ledger-hard/network-hold'})
        for cell in policy['model_order']:
            if STOP.is_set():break
            complete=run_cell(cell)
            print(json.dumps({'cell':cell,'complete':complete,'stamp':stamp()}),flush=True)
            if not complete:break
            for experiment in ('primary','dialect'):
                subprocess.run([str(ROOT.parent.parent/'node_modules/.bin/tsx'),str(HERE/'extended-peer-parity.mts'),cell,*(['--dialect'] if experiment=='dialect' else [])],cwd=ROOT,check=True)
            for script in ('extended-score.py','verify-extended.py'):
                subprocess.run(['python3',str(HERE/script),cell,*(['--require-complete'] if script=='extended-score.py' else [])],cwd=ROOT,check=True)

if __name__=='__main__':main()
