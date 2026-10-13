"""Two additional model cells on the existing sealed cohort, with durable answers."""
import argparse, collections, concurrent.futures, copy, fcntl, os, signal, subprocess, threading, time, urllib.error, urllib.request
from common import *
import run as primary
variant=load_module('extended_dialect',HERE/'dialect-run.py')
CELLS={'sonnet-5-5':{'model':'claude-sonnet-5-5','route':'claude-cli','concurrency':2,'reserve':.10},
       'gpt-6.1-sol':{'model':'gpt-6.1-sol','route':'responses','concurrency':8,'reserve':.05}}
OUTPUT_CAP=4096
CLI_FLAGS=['-p','--output-format','json','--model','sonnet','--tools','','--setting-sources','','--strict-mcp-config','--no-session-persistence','--max-turns','1','--safe-mode','--disable-slash-commands','--effort','medium','--max-budget-usd','0.10']
CLI_ENV={'CLAUDE_CODE_MAX_OUTPUT_TOKENS':'4096','CLAUDE_CODE_EFFORT_LEVEL':'medium','CLAUDE_CODE_MAX_RETRIES':'0','MAX_STRUCTURED_OUTPUT_RETRIES':'1','CLAUDE_CODE_DISABLE_CLAUDE_MDS':'1','CLAUDE_CODE_DISABLE_AUTO_MEMORY':'1','CLAUDE_CODE_DISABLE_TERMINAL_TITLE':'1'}

def lines(path):return [json.loads(s) for s in path.read_text().splitlines()] if path.exists() else []
def answers(dest):return [a for e in ('primary','dialect') for a in lines(dest/e/'calls.jsonl')]
def append(path,value):primary.append(path,value)
def cell_cap(dest):
    path=dest/'budget-amendment.json'
    return json.loads(path.read_text())['cell_cap_usd'] if path.exists() else 25
def sol_cost(usage):
    details=usage.get('input_tokens_details') or {};total=usage.get('input_tokens',0)
    cached=details.get('cached_tokens',0);written=details.get('cache_write_tokens',0)
    assert 0<=cached+written<=total
    return ((total-cached-written)*2+cached*.10+written*2.50+usage.get('output_tokens',0)*10)/1e6

def cli_no_answer(raw):
    usage=raw.get('usage') or {}
    return raw.get('terminal_reason')=='api_error' and not any(usage.get(k,0) for k in ('input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens'))

def connection_failure(a):
    error=a.get('error') or {}
    return not a.get('provider_response') and error.get('status') is None and error.get('type') in ('RemoteDisconnected','URLError','TimeoutError','ConnectionResetError','TimeoutExpired')

def prepared(cell):
    cfg=CELLS[cell];out=[]
    source={'primary':primary.requests(['haiku'],None),'dialect':variant.all_requests(models=['haiku' if cfg['route']=='claude-cli' else 'gpt-6-luna'])}
    for experiment,entries in source.items():
        for e in entries:
            if experiment=='primary':prompt=e['prompt'];schema=None
            elif cfg['route']=='claude-cli':prompt=e['built']['payload'];schema=None
            else:
                old=e['built']['payload'];prompt={'system':old['messages'][0]['content'],'user':old['messages'][1]['content']};schema=(old.get('response_format') or {}).get('json_schema')
            if cfg['route']=='responses':
                body={'model':cfg['model'],'input':[{'role':'system','content':prompt['system']},{'role':'user','content':prompt['user']}],
                      'reasoning':{'effort':'medium'},'max_output_tokens':OUTPUT_CAP,'store':False,'service_tier':'default'}
                if schema:body['text']={'format':{'type':'json_schema',**copy.deepcopy(schema)}}
            else:body={'system':prompt['system'],'user':prompt['user'],'flags':CLI_FLAGS,'environment':CLI_ENV}
            r={k:e[k] for k in ('id','row','side')};r.update(experiment=experiment,model=cfg['model'],body=body)
            r['request_sha256']=sha({'namespace':cell+'-'+experiment+'-20261013-v1','model':cfg['model'],'body':body})
            out.append(r)
    return out

def requests(dest):return json.loads((dest/'requests.json').read_text())
def ordered_unique(dest):
    by={}
    for r in requests(dest):by.setdefault(r['request_sha256'],r)
    queues={e:collections.deque(r for r in by.values() if r['experiment']==e) for e in ('primary','dialect')};out=[]
    while any(queues.values()):
        for q in queues.values():
            if q:out.append(q.popleft())
    return out

def prepare(cell):
    dest=HERE/cell;dest.mkdir(exist_ok=True);assert not (dest/'seal.json').exists()
    for e in ('primary','dialect','empty'):(dest/e).mkdir(exist_ok=True)
    (dest/'.gitignore').write_text('runner.lock\nrun.log\nprocess.json\ndrain\nempty/\n')
    dump(dest/'requests.json',prepared(cell));assert len(ordered_unique(dest))==6560
    pricing={'verified_on':'2026-10-13','model':CELLS[cell]['model'],'source':'https://developers.openai.com/api/docs/pricing' if cell=='gpt-6.1-sol' else 'CLI total_cost_usd per call',
             'usd_per_million':{'input':2,'cached_input':.1,'cache_write':2.5,'output_including_reasoning':10} if cell=='gpt-6.1-sol' else None,
             'tier':'Standard short context, synchronous Responses; service_tier default' if cell=='gpt-6.1-sol' else 'CLI-reported cost is authoritative'}
    dump(dest/'pricing.json',pricing)
    paths=[HERE/p for p in ['extended-run.py','extended-score.py','extended-peer-parity.mts','test_extended.py','score.py','common.py','run.py','dialect-run.py']]+[dest/'requests.json',dest/'pricing.json']
    old=[HERE/'calls.jsonl',HERE/'dialect/calls.jsonl',HERE/'flash-lite/primary/calls.jsonl',HERE/'flash-lite/dialect/calls.jsonl']
    seal={'created':stamp(),'authority':'Owner requests claude-sonnet-5-5 and gpt-6.1-sol; both contestants, sealed set once, 5 Sonnet cost calls before full cell; stop if projected cell cost exceeds USD 25; Gemini 3.8 stays parked.',
          'cell':cell,**CELLS[cell],'cell_cap_usd':25,'experiments':['primary','dialect'],'cases_per_row':384,'planned_unique_calls':6560,
          'interpretation':'Carry forward the two-experiment layout of the previous added model. Each model allocation covers both experiments and the equal-state ablation.',
          'reasoning':'medium for both contestants in both experiments','temperature':'omitted','total_generated_token_cap':OUTPUT_CAP,
          'thinking_limit_note':'Responses max_output_tokens includes hidden reasoning. Sonnet 5.5 is adaptive and ignores positive MAX_THINKING_TOKENS; constrain total generated tokens through CLAUDE_CODE_MAX_OUTPUT_TOKENS instead.',
          'thinking_sources':['https://developers.openai.com/api/docs/guides/reasoning','https://code.claude.com/docs/en/env-vars'],
          'no_content_retry':True,'transport_tries':3,'transport_wait_seconds':[10,30],'quota_wait_seconds':[20,60,180],'http_402':'immediate stop, no retry, unscored',
          'pilot':'First five requests in the frozen rotating experiment order, retained once. Gate continuation only on cost, model identity and transport integrity, never accuracy. Reproject after first 50 calls and each later 100.',
          'cost_projection_rule':'Mean measured USD per pilot request times 6560. Subsequent projection stratifies by experiment, row and contestant once all groups have observations; otherwise uses the overall mean.',
          'unknown_attempt_reserve_usd':CELLS[cell]['reserve'],'request_timeout_seconds':180,'last_call_cutoff':'2026-10-14T12:00:00+00:00',
          'original_seal_sha256':digest(HERE/'seal.json'),'dialect_seal_sha256':digest(HERE/'dialect/seal.json'),
          'candidate_procedure_sha256':native.procedure_fingerprint(),'prior_journal_sha256':{str(p.relative_to(ROOT)):digest(p) for p in old},
          'sha256':{str(p.relative_to(ROOT)):digest(p) for p in paths}}
    dump(dest/'seal.json',seal);print(json.dumps({'cell':cell,'unique':6560,'seal_sha256':digest(dest/'seal.json')}))

def verify(cell):
    dest=HERE/cell;seal=json.loads((dest/'seal.json').read_text())
    assert subprocess.check_output(['git','show',f'HEAD:comparisons/ledger-hard/{cell}/seal.json'],cwd=ROOT)==(dest/'seal.json').read_bytes()
    amendment=HERE/'extended-runtime-amendment.json'
    replacements={}
    if amendment.exists():
        assert subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/extended-runtime-amendment.json'],cwd=ROOT)==amendment.read_bytes()
        replacements=json.loads(amendment.read_text())['source_replacements']
    for p,h in seal['sha256'].items():
        if p in replacements:
            assert replacements[p]['original']==h
            h=replacements[p]['runtime']
        assert digest(ROOT/p)==h,p
    budget=dest/'budget-amendment.json'
    if budget.exists():assert subprocess.check_output(['git','show',f'HEAD:comparisons/ledger-hard/{cell}/budget-amendment.json'],cwd=ROOT)==budget.read_bytes()
    for p,h in seal['prior_journal_sha256'].items():assert digest(ROOT/p)==h,p
    primary.verify_seal();variant.verify();return seal

def parse_response(raw):
    content=''.join(part.get('text','') for item in raw.get('output',[]) if item.get('type')=='message' for part in item.get('content',[]) if part.get('type')=='output_text')
    usage=raw.get('usage') or {};reason=(raw.get('incomplete_details') or {}).get('reason')
    return {'success':raw.get('status')=='completed' and bool(content),'text':content,'usage':usage,'measured_usd':sol_cost(usage),'resolved_model':raw.get('model'),
            'reasoning_applied':(raw.get('reasoning') or {}).get('effort'),'token_limit_lost':reason=='max_output_tokens','generated_tokens':usage.get('output_tokens',0),'provider_response':raw}

class Driver:
    def __init__(self,cell):
        self.cell=cell;self.dest=HERE/cell;self.cfg=CELLS[cell];self.lock=threading.RLock();self.stop=threading.Event()
        self.measured,self.reserved=accounting(self.dest)
        self.cache_disabled=None
        self.connection_streak=0;self.stop_reason=None
        self.history=collections.defaultdict(list)
        for x in lines(self.dest/'attempts.jsonl'):
            if x['event']=='finish':self.history[x['request_sha256']].append(x)
    def observe_transport(self,a):
        if self.cfg['route']=='responses':
            self.connection_streak=self.connection_streak+1 if connection_failure(a) else 0
            if self.connection_streak>=2:
                self.stop_reason='two consecutive connection failures';self.stop.set()
    def totals(self):
        with self.lock:return self.measured,self.reserved
    def attempt(self,r,number):
        a={k:r[k] for k in ('experiment','model','id','row','side','request_sha256')};a.update(started=stamp(),attempt=number,reasoning_requested='medium')
        try:
            if self.cfg['route']=='responses':
                secret=(Path.home()/'.nexus-secrets/openai.key').read_text().strip()
                req=urllib.request.Request('https://api.openai.com/v1/responses',data=json.dumps(r['body']).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+secret})
                with urllib.request.urlopen(req,timeout=180) as response:raw=json.loads(response.read())
                a.update(parse_response(raw))
            else:
                env=dict(os.environ);env.pop('CLAUDECODE',None);env.pop('MAX_THINKING_TOKENS',None);env.pop('CLAUDE_CODE_DISABLE_THINKING',None);env.update(CLI_ENV)
                if self.cache_disabled is not None:
                    env['DISABLE_PROMPT_CACHING']='1' if self.cache_disabled else '0'
                    a['runtime_environment']={'DISABLE_PROMPT_CACHING':env['DISABLE_PROMPT_CACHING']}
                ran=subprocess.run(['claude',*CLI_FLAGS,'--system-prompt',r['body']['system']],input=r['body']['user'],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,cwd=self.dest/'empty',timeout=180)
                a['cli_stdout']=ran.stdout
                raw=json.loads(ran.stdout);usage=raw.get('usage') or {};a.update(provider_response=raw,exit_code=ran.returncode,
                    success=ran.returncode==0 and raw.get('subtype')=='success' and not raw.get('is_error'),text=raw.get('result') or '',usage=usage,
                    measured_usd=raw.get('total_cost_usd'),resolved_model=sorted(raw.get('modelUsage',{})),generated_tokens=usage.get('output_tokens',0),
                    token_limit_lost=raw.get('stop_reason')=='max_tokens' or usage.get('output_tokens',0)>=OUTPUT_CAP,reasoning_applied='medium requested; CLI does not expose resolved effort')
                if cli_no_answer(raw):
                    a['cli_error_response']=a.pop('provider_response');a['text']=''
                    status=raw.get('api_error_status')
                    a['error']={'type':'ConnectionResetError' if status is None else 'CLIHTTPError','status':status,'message':raw.get('result','')}
                    if status is None:a['unreported_cost_reserve_usd']=self.cfg['reserve']
            if a.get('measured_usd') is None:a['unreported_cost_reserve_usd']=self.cfg['reserve']
            model=a.get('resolved_model');a['model_match']=model==self.cfg['model'] or model==[self.cfg['model']]
            if a.get('provider_response') and (not a['model_match'] or a.get('generated_tokens',0)>OUTPUT_CAP):self.stop.set();a['integrity_stop']=True
        except urllib.error.HTTPError as error:
            a.update(success=False,text='',measured_usd=0,error={'status':error.code,'body':error.read().decode(errors='replace')})
        except Exception as error:
            a.update(success=False,text='',measured_usd=None,unreported_cost_reserve_usd=self.cfg['reserve'],error={'type':type(error).__name__,'message':str(error)})
        a['finished']=stamp();return a
    def work(self,r):
        history=self.history.get(r['request_sha256'],[])
        transport=sum(variant.retryable(x) or cli_no_answer(x.get('provider_response') or {}) for x in history)
        quota=sum((x.get('error') or {}).get('status')==429 for x in history)
        number=max((x['attempt'] for x in history),default=0)
        assert transport<3 and quota<4,'Exhausted attempts cannot be restarted'
        if history:
            delay=10 if transport==1 else 30
            with self.lock:append(self.dest/'attempts.jsonl',{'event':'backoff','request_sha256':r['request_sha256'],'attempt':number+1,'seconds':delay,'stamp':stamp(),'reason':'resume proven unanswered attempt within original retry limit'})
            self.stop.wait(delay)
        while True:
            if self.stop.is_set():
                a={'pending':True,'request_sha256':r['request_sha256'],'reason':'stop before dispatch','stamp':stamp()}
                with self.lock:append(self.dest/'pending.jsonl',a)
                return a
            number+=1
            with self.lock:append(self.dest/'attempts.jsonl',{'event':'start','request_sha256':r['request_sha256'],'attempt':number,'stamp':stamp()})
            a=self.attempt(r,number)
            with self.lock:
                append(self.dest/'attempts.jsonl',{'event':'finish',**a})
                self.measured+=a.get('measured_usd') or 0;self.reserved+=a.get('unreported_cost_reserve_usd',0)
                self.observe_transport(a)
                if self.connection_streak==2:append(self.dest/'circuit-breaks.jsonl',{'stamp':stamp(),'request_sha256':r['request_sha256'],'reason':self.stop_reason,'consecutive_failures':self.connection_streak})
            status=(a.get('error') or {}).get('status')
            if a.get('provider_response'):break
            if status==402 or status in (400,401,403,404):
                self.stop.set();a['pending']=True
                with self.lock:append(self.dest/'pending.jsonl',a)
                return a
            if status==429:
                quota+=1
                if quota>3:
                    self.stop.set();a['pending']=True
                    with self.lock:append(self.dest/'pending.jsonl',a)
                    return a
                delay=(20,60,180)[quota-1]
            elif variant.retryable(a):
                transport+=1
                if transport>=3:break
                delay=10 if transport==1 else 30
            else:break
            with self.lock:append(self.dest/'attempts.jsonl',{'event':'backoff','request_sha256':r['request_sha256'],'attempt':number+1,'seconds':delay,'stamp':stamp()})
            self.stop.wait(delay)
        decode=native.outcome if r['experiment']=='primary' else variant.outcome
        a['outcome']=decode(a['text'],r['side'],r['row']) if a['success'] else 'inconclusive'
        a['item_lost']=not a['success'] or a['outcome']=='inconclusive'
        with self.lock:append(self.dest/r['experiment']/'calls.jsonl',a)
        return a

def accounting(dest):
    events=[x for x in lines(dest/'attempts.jsonl') if x['event']=='finish']
    correction=dest/'transport-reconciliation.json'
    extra=json.loads(correction.read_text()).get('retained_reserve_usd',0) if correction.exists() else 0
    return sum(x.get('measured_usd') or 0 for x in events),sum(x.get('unreported_cost_reserve_usd',0) for x in events)+extra

def forecast(dest):
    data=answers(dest);planned=ordered_unique(dest);totals=collections.Counter((x['experiment'],x['row'],x['side']) for x in planned)
    counts=collections.Counter((x['experiment'],x['row'],x['side']) for x in data);costs=collections.Counter()
    for x in data:costs[x['experiment'],x['row'],x['side']]+=x.get('measured_usd') or 0
    measured,reserve=accounting(dest)
    projection=sum(costs[k]/counts[k]*n for k,n in totals.items()) if all(counts[k] for k in totals) else sum(costs.values())/len(data)*len(planned) if data else None
    result={'stamp':stamp(),'recorded':len(data),'planned':len(planned),'measured_usd':measured,'unknown_attempt_reserve_usd':reserve,'projected_usd':projection,
            'method':'experiment/row/contestant stratified' if all(counts[k] for k in totals) else 'prefix mean; family mix may change','outcomes_used':False}
    dump(dest/'cost-forecast.json',result);return result

def run(cell,pilot=False,cache_pilot=False):
    seal=verify(cell);d=Driver(cell);dest=d.dest
    cap=cell_cap(dest)
    with (dest/'runner.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        allreq=ordered_unique(dest);old=answers(dest);seen={a['request_sha256'] for a in old};assert len(seen)==len(old)
        starts={x['request_sha256'] for x in lines(dest/'starts.jsonl')}
        attempts=lines(dest/'attempts.jsonl')
        for key in starts-seen:
            events=[x for x in attempts if x['request_sha256']==key and x['event'] in ('start','finish')]
            completed=[x for x in events if x['event']=='finish']
            assert completed and len(completed)*2==len(events),'Unknown in-flight request cannot be resent'
            assert all(not x.get('provider_response') or cli_no_answer(x['provider_response']) for x in completed),'Answered request cannot be resent'
            append(dest/'no-answer-recovery.jsonl',{'stamp':stamp(),'request_sha256':key,'prior_completed_attempts':len(completed),'evidence':'Every attempt ended with recorded no-answer transport evidence; remaining tries only'})
        if cache_pilot:
            assert cell=='sonnet-5-5' and 5<=len(old)<10
            assert cap==45
            d.cache_disabled=True
        elif pilot:assert not old
        else:
            assert len(old)>=5,'Run five-call pilot first'
            gate=forecast(dest);assert gate['projected_usd']<=cap,'Projected cost exceeds cell cap; owner decision required'
            assert all(x.get('model_match') and not x.get('integrity_stop') for x in old if x.get('provider_response'))
            if cell=='sonnet-5-5' and (dest/'budget-amendment.json').exists():
                choice=json.loads((dest/'cache-choice.json').read_text())
                assert subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/sonnet-5-5/cache-choice.json'],cwd=ROOT)==(dest/'cache-choice.json').read_bytes()
                d.cache_disabled=choice['disable_prompt_caching']
        queue=collections.deque(r for r in (allreq[5:10] if cache_pilot else allreq[:5] if pilot else allreq) if r['request_sha256'] not in seen)
        reason=None;inflight={};fresh=0;last_projection=len(old)
        signal.signal(signal.SIGTERM,lambda *_:d.stop.set());signal.signal(signal.SIGINT,lambda *_:d.stop.set())
        with concurrent.futures.ThreadPoolExecutor(max_workers=d.cfg['concurrency']) as pool:
            while queue or inflight:
                if (dest/'drain').exists():d.stop.set();reason='drain requested'
                if datetime.datetime.now(datetime.timezone.utc)>=datetime.datetime.fromisoformat(seal['last_call_cutoff']):d.stop.set();reason='cutoff'
                measured,reserved=d.totals()
                while queue and not d.stop.is_set() and len(inflight)<d.cfg['concurrency']:
                    if measured+reserved+(len(inflight)+1)*d.cfg['reserve']>cap:
                        if not inflight:d.stop.set();reason='budget reserve'
                        break
                    r=queue.popleft()
                    if r['request_sha256'] not in starts:
                        append(dest/'starts.jsonl',{k:v for k,v in r.items() if k!='body'}|{'started':stamp()});starts.add(r['request_sha256'])
                    inflight[pool.submit(d.work,r)]=r
                if not inflight:break
                done,_=concurrent.futures.wait(inflight,timeout=10,return_when=concurrent.futures.FIRST_COMPLETED)
                for fut in done:
                    r=inflight.pop(fut);a=fut.result()
                    if a.get('pending'):queue.appendleft(r);reason='provider or integrity stop';continue
                    fresh+=1
                    if a.get('integrity_stop'):reason='model identity or token cap defect'
                count=len(old)+fresh
                if d.stop_reason:reason=d.stop_reason
                if not pilot and not cache_pilot and (count>=50 and last_projection<50 or count-last_projection>=100):
                    projected=forecast(dest);last_projection=count
                    if projected['projected_usd']>cap:d.stop.set();reason='projection exceeds cell cap'
                measured,reserved=d.totals()
                dump(dest/'run-state.json',{'stamp':stamp(),'model':d.cfg['model'],'completed':count,'planned':6560,'inflight':len(inflight),'measured_usd':measured,'unknown_attempt_reserve_usd':reserved,'stop_reason':reason})
        state={'stamp':stamp(),'model':d.cfg['model'],'completed':len(answers(dest)),'planned':6560,'inflight':0,'measured_usd':accounting(dest)[0],'unknown_attempt_reserve_usd':accounting(dest)[1],'stop_reason':reason,'pilot':pilot}
        dump(dest/'run-state.json',state);projected=forecast(dest)
        if pilot:dump(dest/'pilot.json',projected|{'requests':[r['request_sha256'] for r in allreq[:5]],'retained_once':True})
        if cache_pilot:
            pilot_keys={r['request_sha256'] for r in allreq[5:10]}
            new=[a for a in answers(dest) if a['request_sha256'] in pilot_keys]
            dump(dest/'cache-pilot.json',{'stamp':stamp(),'requests':[a['request_sha256'] for a in new],'recorded':len(new),'measured_usd':sum(a.get('measured_usd') or 0 for a in new),'disable_prompt_caching':True,'retained_once':True,'outcomes_used':False})
        with primary.LEDGER.open('a') as f:f.write(f'\n| {stamp()} | ledger-hard {cell} {"cache pilot" if cache_pilot else "five-call pilot" if pilot else "sealed run"} | {state["completed"]}/6560 recorded | {state["measured_usd"]:.8f} USD; {state["unknown_attempt_reserve_usd"]:.8f} reserve | {cap} USD model-cell cap; projected {projected["projected_usd"]}; stop {reason} |\n')
        print(json.dumps(state|{'projected_usd':projected['projected_usd']}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['prepare','pilot','cache-pilot','run']);p.add_argument('cell',choices=CELLS);a=p.parse_args()
    prepare(a.cell) if a.mode=='prepare' else run(a.cell,a.mode=='pilot',a.mode=='cache-pilot')
