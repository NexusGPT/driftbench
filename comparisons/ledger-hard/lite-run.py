"""Separate sealed Flash-Lite cell; no original model journal is mutated."""
import argparse, collections, concurrent.futures, copy, fcntl, os, signal, subprocess, threading, time, urllib.error, urllib.request
from common import *
import run as primary
variant=load_module('lite_dialect',HERE/'dialect-run.py')
DEST=HERE/'flash-lite'
MODEL='gemini-3.5-flash-lite'
LOCK=threading.RLock()
STOP=threading.Event()
LIMIT=8

def lines(path):return [json.loads(s) for s in path.read_text().splitlines()] if path.exists() else []
def append(path,value):primary.append(path,value)
def all_answers():return [a for e in ('primary','dialect') for a in lines(DEST/e/'calls.jsonl')]
def cost(usage):
    cached=usage.get('cachedContentTokenCount',0)
    return (max(0,usage.get('promptTokenCount',0)-cached)*.30+cached*.03+(usage.get('candidatesTokenCount',0)+usage.get('thoughtsTokenCount',0))*2.50)/1e6

def prepared_requests():
    original=json.loads((HERE/'prompts.json').read_text())
    lookup={(r['id'],r['side']):r for r in original}
    out=[]
    for r in primary.requests(['haiku'],None):
        e=lookup[r['id'],r['side']];p=e['prompt']
        body={'systemInstruction':{'parts':[{'text':p['system']}]},'contents':[{'role':'user','parts':[{'text':p['user']}]}],
              'generationConfig':{'thinkingConfig':{'thinkingLevel':'medium'},'maxOutputTokens':4096}}
        out.append({'experiment':'primary','model':MODEL,'id':r['id'],'row':r['row'],'side':r['side'],'body':body})
    for r in variant.all_requests(models=['gemini-3.8-flash']):
        body=copy.deepcopy(r['built']['payload']);body['generationConfig']['maxOutputTokens']=4096
        out.append({'experiment':'dialect','model':MODEL,'id':r['id'],'row':r['row'],'side':r['side'],'body':body})
    return out

def requests(reasoning='medium'):
    result=[]
    for original in json.loads((DEST/'requests.json').read_text()):
        r=copy.deepcopy(original)
        if reasoning=='provider default':r['body']['generationConfig'].pop('thinkingConfig',None)
        r['reasoning_applied']=reasoning
        r['request_sha256']=sha({'experiment':'flash-lite-'+r['experiment']+'-v1','model':MODEL,'body':r['body']})
        result.append(r)
    return result

def unique_requests(reasoning):
    unique={}
    for r in requests(reasoning):unique.setdefault(r['request_sha256'],r)
    return list(unique.values())

def verify_seal():
    seal=json.loads((DEST/'seal.json').read_text())
    assert subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/flash-lite/seal.json'],cwd=ROOT)==(DEST/'seal.json').read_bytes()
    hashes=dict(seal['sha256'])
    budget_path=DEST/'budget-amendment.json'
    if budget_path.exists():
        budget=json.loads(budget_path.read_text())
        assert subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/flash-lite/budget-amendment.json'],cwd=ROOT)==budget_path.read_bytes()
        hashes.update(budget['sha256'])
        seal=seal|{k:budget[k] for k in ('cell_cap_usd','overall_cap_usd')}
    for path,value in hashes.items():assert digest(ROOT/path)==value,path
    primary.verify_seal();variant.verify()
    return seal

def prepare():
    assert not (DEST/'seal.json').exists(),'Never replace an existing seal'
    for e in ('primary','dialect'):(DEST/e).mkdir(parents=True,exist_ok=True)
    dump(DEST/'requests.json',prepared_requests())
    pricing={'verified_on':'2026-10-13','source':'https://ai.google.dev/gemini-api/docs/pricing',
             'guide':'https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6',
             'model':MODEL,'tier':'Standard paid synchronous text','usd_per_million':{'input':.30,'cached_input':.03,'output_including_thinking':2.50},
             'reasoning_documentation':'medium supported; provider default minimal',
             'explicit_cache_storage':'Not used; no cache resource is created'}
    dump(DEST/'pricing.json',pricing)
    paths=[HERE/'lite-run.py',HERE/'lite-score.py',HERE/'lite-peer-parity.mts',DEST/'requests.json',DEST/'pricing.json',HERE/'score.py',HERE/'common.py']
    data={'created':stamp(),'model':MODEL,'authority':'Owner: NEW gemini-3.5-flash-lite model cell, both experiments, same sealed cohort, cap USD 4 and overall cap USD 16. Eight simultaneous calls, 429 waits 20/60/180, 402 stops immediately. Gemini 3.8 remains parked until owner word.',
          'same_cohort_seal_sha256':digest(HERE/'seal.json'),'dialect_seal_sha256':digest(HERE/'dialect/seal.json'),
          'reasoning_policy':'Try medium on the first sealed primary request. Only an explicit unsupported-thinking HTTP 400 before any recorded answer permits provider default. Apply the selected setting to both contestants in both experiments. No content retry.',
          'reasoning_default_request_derivation':'Remove thinkingConfig from generationConfig only; complete payload is covered by the frozen requests() function and resulting fingerprint.',
          'temperature':'omitted','max_output_tokens':4096,'request_timeout_seconds':180,'concurrency':8,
          'http_429_wait_seconds':[20,60,180],'transport_attempts':3,'transport_wait_seconds':[10,30],
          'cell_cap_usd':4,'overall_cap_usd':16,'prior_measured_usd':variant.known_total(),'lost_attempt_reserve_usd':.4,'per_active_call_reserve_usd':.02,
          'last_call_cutoff':'2026-10-14T12:00:00+00:00','cases_per_row':384,'cases_per_experiment':1536,'planned_unique_calls_per_experiment':3280,
          'statistics':'Reuse unchanged score.summary: exact two-sided McNemar, one-sided paired tail, Wilson intervals, 20000 family-cluster bootstrap draws. Nominal lead requires W>L and two-sided p<.05; LOSS requires L>W and p<.05; global multiplicity decisions belong to collator.',
          'independence':'Separate model and request keys. Same case cohort is not independent replication. Never pool with Gemini 3.8 results.',
          'parked_journal_sha256':{str(p.relative_to(ROOT)):digest(p) for p in [HERE/'calls.jsonl',HERE/'dialect/calls.jsonl']},
          'sha256':{str(p.relative_to(ROOT)):digest(p) for p in paths}}
    dump(DEST/'seal.json',data)
    for mode in ('medium','provider default'):
        reqs=unique_requests(mode);assert len(reqs)==6560
        assert collections.Counter(r['experiment'] for r in reqs)=={'primary':3280,'dialect':3280}
    print(json.dumps({'sealed_entries':len(prepared_requests()),'unique_calls':6560,'seal_sha256':digest(DEST/'seal.json')}))

def attempt(r,number):
    a={k:r[k] for k in ('experiment','model','id','row','side','reasoning_applied','request_sha256')}
    a.update(started=stamp(),attempt=number)
    try:
        secret=(Path.home()/'.nexus-secrets/gemini-driftbench.key').read_text().strip()
        req=urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent',data=json.dumps(r['body']).encode(),headers={'Content-Type':'application/json','x-goog-api-key':secret})
        with urllib.request.urlopen(req,timeout=180) as response:raw=json.loads(response.read())
        candidate=(raw.get('candidates') or [{}])[0];usage=raw.get('usageMetadata') or {}
        text=''.join(x.get('text','') for x in candidate.get('content',{}).get('parts',[]) if not x.get('thought'))
        a.update(success=candidate.get('finishReason')=='STOP',text=text,usage=usage,measured_usd=cost(usage),resolved_model=raw.get('modelVersion',MODEL),provider_response=raw)
    except urllib.error.HTTPError as error:a.update(success=False,text='',measured_usd=0,error={'status':error.code,'body':error.read().decode(errors='replace')})
    except Exception as error:a.update(success=False,text='',measured_usd=0,error={'type':type(error).__name__,'message':str(error)})
    a['finished']=stamp()
    return a

def recorded_attempt(r,number):
    with LOCK:append(DEST/'attempts.jsonl',{'event':'start','stamp':stamp(),'request_sha256':r['request_sha256'],'experiment':r['experiment'],'attempt':number})
    a=attempt(r,number)
    with LOCK:append(DEST/'attempts.jsonl',{'event':'finish',**a})
    return a

def record_answer(a):
    decode=native.outcome if a['experiment']=='primary' else variant.outcome
    a['outcome']=decode(a['text'],a['side'],a['row']) if a['success'] else 'inconclusive'
    with LOCK:append(DEST/a['experiment']/'calls.jsonl',a)
    return a

def work(r,allow_configuration_rejection=False):
    transport=quota=number=0
    while True:
        if STOP.is_set():
            pending={'pending':True,'request_sha256':r['request_sha256'],'reason':'circuit break before dispatch','stamp':stamp()}
            with LOCK:append(DEST/'pending.jsonl',pending)
            return pending
        number+=1;a=recorded_attempt(r,number);error=a.get('error') or {};status=error.get('status')
        if a.get('provider_response'):return record_answer(a)
        if status==400 and allow_configuration_rejection:return a
        if status==402:
            STOP.set()
            with LOCK:append(DEST/'pending.jsonl',{'pending':True,'reason':'HTTP 402 billing circuit',**a})
            return dict(a,pending=True)
        if status==429:
            quota+=1
            if quota>3:
                STOP.set()
                with LOCK:append(DEST/'pending.jsonl',{'pending':True,'reason':'HTTP 429 exhausted; unscored',**a})
                return dict(a,pending=True)
            delay=(20,60,180)[quota-1]
        elif variant.retryable(a):
            transport+=1
            if transport>=3:return record_answer(a)
            delay=10 if transport==1 else 30
        else:return record_answer(a)
        with LOCK:append(DEST/'attempts.jsonl',{'event':'backoff','stamp':stamp(),'request_sha256':r['request_sha256'],'attempt':number+1,'seconds':delay})
        STOP.wait(delay)

def probe():
    seal=verify_seal();assert not (DEST/'reasoning-applied.json').exists() and not all_answers()
    medium=unique_requests('medium')[0]
    assert not lines(DEST/'starts.jsonl'),'Reconcile any interrupted probe before repeating'
    append(DEST/'starts.jsonl',{k:v for k,v in medium.items() if k!='body'}|{'started':stamp(),'probe':True})
    a=work(medium,allow_configuration_rejection=True);mode='medium'
    if not a.get('provider_response') and (a.get('error') or {}).get('status')==400:
        body=a['error']['body'].lower()
        assert 'thinking' in body and any(x in body for x in ('unsupported','not supported','invalid','not allowed')),a['error']
        append(DEST/'configuration-rejections.jsonl',a)
        mode='provider default';r=unique_requests(mode)[0]
        append(DEST/'starts.jsonl',{k:v for k,v in r.items() if k!='body'}|{'started':stamp(),'probe':True})
        a=work(r)
    if not a.get('provider_response'):
        append(DEST/'pending.jsonl',{'pending':True,'reason':'Probe returned no answer; reconcile before resume',**a})
        raise RuntimeError('Probe returned no answer; see durable attempt journal')
    dump(DEST/'reasoning-applied.json',{'stamp':stamp(),'model':MODEL,'reasoning_applied':mode,'both_contestants':True,'both_experiments':True,'probe_key':a['request_sha256'],'probe_answer_recorded_once':True,'cost_usd':a['measured_usd'],'http_accepts_setting':True,'resolved_model':a['resolved_model']})
    print(json.dumps(json.loads((DEST/'reasoning-applied.json').read_text())))

def run(limit=None):
    seal=verify_seal();applied=json.loads((DEST/'reasoning-applied.json').read_text());mode=applied['reasoning_applied']
    assert subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/flash-lite/reasoning-applied.json'],cwd=ROOT)==(DEST/'reasoning-applied.json').read_bytes()
    with (DEST/'runner.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        answers=all_answers();seen={a['request_sha256'] for a in answers};assert len(seen)==len(answers)
        starts={r['request_sha256'] for r in lines(DEST/'starts.jsonl')}
        rejected={r['request_sha256'] for r in lines(DEST/'configuration-rejections.jsonl')}
        assert starts-seen-rejected==set(),'Unknown answer after interruption; reconcile before resending'
        queues={e:collections.deque(r for r in unique_requests(mode) if r['experiment']==e and r['request_sha256'] not in seen) for e in ('primary','dialect')}
        order=collections.deque(queues);spent=sum(a['measured_usd'] for a in answers);fresh=0;reason=None;inflight={}
        primary.ledger('Flash-Lite separate cell start; Gemini 3.8 remains owner-held',0,seal['prior_measured_usd']+spent)
        signal.signal(signal.SIGTERM,lambda *_:STOP.set());signal.signal(signal.SIGINT,lambda *_:STOP.set())
        with concurrent.futures.ThreadPoolExecutor(max_workers=LIMIT) as pool:
            while any(queues.values()) or inflight:
                if (DEST/'drain').exists():STOP.set();reason='drain requested'
                if datetime.datetime.now(datetime.timezone.utc)>=datetime.datetime.fromisoformat(seal['last_call_cutoff']):STOP.set();reason='cutoff'
                for _ in range(LIMIT*len(order)):
                    if STOP.is_set() or len(inflight)>=LIMIT:break
                    if limit is not None and fresh+len(inflight)>=limit:break
                    exp=order[0];order.rotate(-1)
                    if not queues[exp]:continue
                    reserve=.02*(len(inflight)+1)
                    if spent+reserve>seal['cell_cap_usd'] or seal['prior_measured_usd']+.4+spent+reserve>seal['overall_cap_usd']:STOP.set();reason='budget reserve';break
                    r=queues[exp].popleft();append(DEST/'starts.jsonl',{k:v for k,v in r.items() if k!='body'}|{'started':stamp()})
                    inflight[pool.submit(work,r)]=r
                if not inflight:break
                finished,_=concurrent.futures.wait(inflight,timeout=10,return_when=concurrent.futures.FIRST_COMPLETED)
                for future in finished:
                    r=inflight.pop(future);a=future.result()
                    if a.get('pending'):queues[r['experiment']].appendleft(r);reason='provider circuit or quota pending';continue
                    fresh+=1;spent+=a['measured_usd']
                state={'stamp':stamp(),'completed':len(answers)+fresh,'planned':6560,'remaining':{e:len(q) for e,q in queues.items()},'inflight':len(inflight),'cell_measured_usd':spent,'combined_plus_reserve_usd':seal['prior_measured_usd']+.4+spent,'stop_reason':reason}
                dump(DEST/'run-state.json',state)
                if fresh and fresh%50==0:print(json.dumps(state),flush=True)
        state={'stamp':stamp(),'completed':len(all_answers()),'planned':6560,'remaining':{e:len(q) for e,q in queues.items()},'inflight':0,'cell_measured_usd':spent,'combined_plus_reserve_usd':seal['prior_measured_usd']+.4+spent,'stop_reason':reason,'limited_batch':limit}
        dump(DEST/'run-state.json',state);primary.ledger('Flash-Lite separate cell finish '+str(reason),fresh,seal['prior_measured_usd']+spent)
        print(json.dumps(state),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['prepare','probe','run']);p.add_argument('--limit',type=int);a=p.parse_args()
    if a.mode=='prepare':prepare()
    elif a.mode=='probe':probe()
    else:run(a.limit)
