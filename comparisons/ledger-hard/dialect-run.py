"""Independent dialect requests, durable worker journals, per-provider adaptive queues."""
import argparse, collections, concurrent.futures, fcntl, os, signal, subprocess, threading, time, urllib.request, urllib.error
from common import *
from run import priced, ledger, append
DEST=HERE/'dialect'
VARIANT_MODELS=('haiku','gpt-6-luna','gemini-3.8-flash')
MUTEX=threading.RLock()
STOP=threading.Event()
WINDOW=collections.deque(maxlen=50)
LUNA_LIMIT=4

def variant_records():
    path=DEST/'calls.jsonl'
    return [json.loads(s) for s in path.read_text().splitlines()] if path.exists() else []

def known_total():
    return sum(priced(r) or 0 for r in records())+sum(r.get('measured_usd') or 0 for r in variant_records())

def all_requests(models=VARIANT_MODELS,limit=None):
    entries=json.loads((DEST/'prompts.json').read_text())
    allowed={c['id'] for row in ROWS for c in cases(row)[:limit]}
    result=[]
    for e in entries:
        if e['model'] not in models or e['id'] not in allowed:continue
        r=dict(e)
        r['request_sha256']=sha({'experiment':'dialect-medium-v1','model':e['model'],'provider':e['provider'],
                                'payload':e['built']['payload'],'max_tokens':4096,'flags':native.FLAGS if e['model']=='haiku' else None})
        result.append(r)
    return result

def outcome(text,side,row):
    if side=='audit':
        objects,cut=native.json_objects(text)
        return native.outcome(objects[-1],side,row) if objects and not cut else 'inconclusive'
    return native.outcome(text,side,row)

def attempt(r,number):
    start=stamp(); model=r['model']; payload=r['built']['payload']
    answer={'request_sha256':r['request_sha256'],'model':model,'row':r['row'],'side':r['side'],'id':r['id'],
            'started':start,'attempt':number,'dialect':r['built']['dialect'],'dialect_fingerprint':r['built']['fingerprint']}
    try:
        if model=='haiku':
            env=dict(os.environ);env.pop('CLAUDECODE',None)
            ran=subprocess.run(['claude',*native.FLAGS,'--system-prompt',payload['system'],'--max-budget-usd','0.02'],
                input=payload['user'],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,cwd=DEST,env=env,timeout=180)
            raw=json.loads(ran.stdout);cost=raw.get('total_cost_usd')
            answer.update(success=ran.returncode==0 and raw.get('subtype')=='success' and not raw.get('is_error'),
                text=raw.get('result',''),measured_usd=cost,usage=raw.get('usage'),resolved_model=sorted(raw.get('modelUsage',{})),provider_response=raw)
        else:
            keyfile='openai.key' if model=='gpt-6-luna' else 'gemini-driftbench.key'
            secret=(Path.home()/'.nexus-secrets'/keyfile).read_text().strip()
            if model=='gpt-6-luna':
                url='https://api.openai.com/v1/chat/completions';headers={'Authorization':'Bearer '+secret}
                body={'model':model,**payload,'max_completion_tokens':4096}
            else:
                url=f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';headers={'x-goog-api-key':secret}
                body={**payload,'generationConfig':{**payload.get('generationConfig',{}),'maxOutputTokens':4096}}
            request=urllib.request.Request(url,data=json.dumps(body).encode(),headers={'Content-Type':'application/json',**headers})
            with urllib.request.urlopen(request,timeout=180) as response:raw=json.loads(response.read())
            if model=='gpt-6-luna':
                choice=raw.get('choices',[{}])[0]
                answer.update(success=choice.get('finish_reason')=='stop',text=choice.get('message',{}).get('content') or '',
                    measured_usd=None,usage=raw.get('usage'),resolved_model=raw.get('model'),provider_response=raw)
                answer['measured_usd']=priced(answer)
            else:
                candidate=raw.get('candidates',[{}])[0];usage=raw.get('usageMetadata',{})
                text=''.join(p.get('text','') for p in candidate.get('content',{}).get('parts',[]) if not p.get('thought'))
                answer.update(success=candidate.get('finishReason')=='STOP',text=text,usage=usage,
                    measured_usd=(usage.get('promptTokenCount',0)*.75+(usage.get('candidatesTokenCount',0)+usage.get('thoughtsTokenCount',0))*3.75)/1e6,
                    resolved_model=raw.get('modelVersion',model),provider_response=raw)
    except urllib.error.HTTPError as error:
        answer.update(success=False,text='',measured_usd=None,error={'status':error.code,'body':error.read().decode(errors='replace')})
    except Exception as error:
        answer.update(success=False,text='',measured_usd=None,error={'type':type(error).__name__,'message':str(error)})
    answer['finished']=stamp()
    return answer

def retryable(a):
    e=a.get('error') or {}
    return not a['success'] and not a.get('provider_response') and (e.get('type') in ('RemoteDisconnected','URLError','TimeoutError','ConnectionResetError','TimeoutExpired') or e.get('status') in (408,429,500,502,503,504,529))

def work(r):
    global LUNA_LIMIT
    for number in range(1,4):
        if number>1:
            delay=10 if number==2 else 30
            with MUTEX:append(DEST/'attempts.jsonl',{'event':'backoff','request_sha256':r['request_sha256'],'attempt':number,'seconds':delay,'stamp':stamp()})
            time.sleep(delay)
        with MUTEX:append(DEST/'attempts.jsonl',{'event':'start','request_sha256':r['request_sha256'],'attempt':number,'model':r['model'],'stamp':stamp()})
        answer=attempt(r,number)
        with MUTEX:
            append(DEST/'attempts.jsonl',{'event':'finish',**answer})
            if r['model']=='gpt-6-luna':
                WINDOW.append(not answer['success'] and retryable(answer))
                if len(WINDOW)==50 and sum(WINDOW)/50>.05 and LUNA_LIMIT!=2:
                    LUNA_LIMIT=2
                    append(DEST/'events.jsonl',{'stamp':stamp(),'event':'luna-concurrency-reduced','limit':2,'failures_last_50':sum(WINDOW)})
        if answer['success'] or not retryable(answer):break
    answer['outcome']=outcome(answer['text'],r['side'],r['row']) if answer['success'] else 'inconclusive'
    # The worker commits its result before the future completes. A main-thread
    # interruption cannot discard an answer that reached a worker.
    with MUTEX:append(DEST/'calls.jsonl',answer)
    return answer

def verify():
    seal=json.loads((DEST/'seal.json').read_text())
    for name,expected in seal['sha256'].items():assert digest(ROOT/name)==expected,name
    fixed=subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/dialect/seal.json'],cwd=ROOT)
    assert fixed==(DEST/'seal.json').read_bytes(),'Commit the variant seal before calls'
    return seal

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models',nargs='+',choices=VARIANT_MODELS,default=list(VARIANT_MODELS))
    parser.add_argument('--limit',type=int);parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    verify()
    with (DEST/'runner.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        previous=variant_records();done={r['request_sha256'] for r in previous}
        starts_path=DEST/'starts.jsonl'
        starts=[json.loads(s) for s in starts_path.read_text().splitlines()] if starts_path.exists() else []
        if {r['request_sha256'] for r in starts}-done:raise RuntimeError('Unfinished started keys require reconciliation')
        unique={}
        for r in all_requests(args.models,args.limit):unique.setdefault(r['request_sha256'],r)
        pending={m:collections.deque(r for key,r in unique.items() if key not in done and r['model']==m) for m in args.models}
        print(json.dumps({'pending':{m:len(q) for m,q in pending.items()},'measured_usd_total':known_total(),'execute':args.execute}),flush=True)
        if not args.execute:return
        ledger('dialect start '+','.join(args.models),0,known_total())
        signal.signal(signal.SIGTERM,lambda *_:STOP.set());signal.signal(signal.SIGINT,lambda *_:STOP.set())
        inflight={};fresh=0;stop=None
        limits={'haiku':6,'gemini-3.8-flash':4}
        with concurrent.futures.ThreadPoolExecutor(max_workers=14) as pool:
            while any(pending.values()) or inflight:
                if (DEST/'drain').exists():STOP.set();stop='drain requested'
                with MUTEX:
                    spent=known_total()
                    # The still-running primary has no shared dispatcher; count
                    # its currently outstanding reservations before new calls.
                    primary_starts=[json.loads(s) for s in (HERE/'starts.jsonl').read_text().splitlines()]
                    primary_outstanding=max(0,len(primary_starts)-len(records()))
                for model,queue in pending.items():
                    limit=LUNA_LIMIT if model=='gpt-6-luna' else limits[model]
                    active=sum(r['model']==model for r in inflight.values())
                    while not STOP.is_set() and queue and active<limit:
                        if spent+.02*(len(inflight)+primary_outstanding+1)>10:STOP.set();stop='shared measured-spend reserve';break
                        r=queue.popleft()
                        with MUTEX:append(starts_path,{k:v for k,v in r.items() if k not in ('prompt','built')}|{'started':stamp()})
                        inflight[pool.submit(work,r)]=r;active+=1
                if not inflight:break
                completed,_=concurrent.futures.wait(inflight,timeout=10,return_when=concurrent.futures.FIRST_COMPLETED)
                for future in completed:
                    r=inflight.pop(future);a=future.result();fresh+=1
                    if not a['success']:print(json.dumps({'final_failure':r['request_sha256'],'model':r['model'],'error':a.get('error')}),flush=True)
                    if fresh%50==0:
                        print(json.dumps({'fresh_completed':fresh,'remaining':{m:len(q) for m,q in pending.items()},'measured_usd_total':known_total(),'luna_limit':LUNA_LIMIT}),flush=True)
        summary={'stamp':stamp(),'completed':len(variant_records()),'measured_usd_total':known_total(),'stop_reason':stop,'luna_limit':LUNA_LIMIT}
        dump(DEST/'run-state.json',summary);ledger('dialect finish '+str(stop),fresh,known_total());print(json.dumps(summary),flush=True)

if __name__=='__main__':main()
