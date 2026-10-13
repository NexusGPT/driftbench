"""One bounded solver-only ablation on blind Verify practice, recorded offline."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import urllib.error

from . import client, pointwise_router as r, two_step as t, verify_prior as v
from .experts import SOLVE_SYSTEM, first_object
from .panel_clients import append, lines

OUT = r.OUT/'strong-solver'
CONFIG = r.ROOT/'configs/pw-strong-solver-frozen.json'
MODELS = {'sol': 'gpt-6.1-sol', 'sonnet': 'claude-sonnet-5-5'}
MATCH = 'Does the reply reach the same final answer as the reference answer? Equivalent forms of the same value match.'
CAP = 10.0
MAX_OUTPUT = 16384
SELECTION = 'Max official tuning accuracy with pass recall >=0.5; ties balanced accuracy then higher threshold. Grouped OOF diagnostic.'


def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def signal_path(i, model): return OUT/'signals'/model/(hashlib.sha256(i['id'].encode()).hexdigest()+'.json')
def get(i, model): return json.loads(signal_path(i, model).read_text())


def sol_cost(raw):
    u = raw.get('usage') or {}
    if 'prompt_tokens' not in u or 'completion_tokens' not in u:
        return None
    d = u.get('prompt_tokens_details') or {}
    cached = d.get('cached_tokens', 0)
    writes = d.get('cache_write_tokens', d.get('cache_creation_tokens', 0))
    # Output tokens already include reasoning tokens; do not add them again.
    return ((u['prompt_tokens']-cached-writes)*2 + cached*.1 + writes*2.5 + u['completion_tokens']*10)/1e6


def request(model, question):
    assert model in MODELS
    if model == 'sol':
        return {'model': MODELS[model], 'body': {'model': MODELS[model],
            'messages': [{'role':'system','content':SOLVE_SYSTEM}, {'role':'user','content':question}],
            'response_format': {'type':'json_object'}, 'reasoning_effort':'medium',
            'max_completion_tokens':MAX_OUTPUT, 'service_tier':'default'}}
    flags = ['-p','--output-format','json','--model',MODELS[model], '--system-prompt',SOLVE_SYSTEM,
             '--effort','medium','--tools','','--setting-sources','','--strict-mcp-config',
             '--no-session-persistence','--max-turns','1','--max-budget-usd','0.50','--disable-slash-commands']
    return {'model': MODELS[model], 'flags':flags, 'user':question,
            'environment': {'DISABLE_PROMPT_CACHING':'1','CLAUDE_CODE_MAX_OUTPUT_TOKENS':str(MAX_OUTPUT)}}


def send(model, req):
    if model == 'sol':
        raw = client._post('https://api.openai.com/v1/chat/completions',
                          {'authorization':'Bearer '+client._key(client.OPENAI_KEY)}, req['body'], 600)
        c = (raw.get('choices') or [{}])[0]
        return {'raw':raw, 'text':(c.get('message') or {}).get('content') or '',
                'usd':sol_cost(raw), 'finish':c.get('finish_reason'), 'model':raw.get('model')}
    env = dict(os.environ); env.pop('CLAUDECODE',None)
    env.update(req['environment']); env['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC']='1'
    with tempfile.TemporaryDirectory(prefix='moj-strong-') as folder:
        proc = subprocess.run(['claude',*req['flags']],input=req['user'],text=True,
                              stdout=subprocess.PIPE,stderr=subprocess.STDOUT,cwd=folder,env=env,timeout=600)
    try:
        raw = json.loads(proc.stdout)
    except ValueError:
        # A returned malformed answer is still terminal, never submitted again.
        return {'text':proc.stdout, 'usd':None, 'exit':proc.returncode, 'malformed':True}
    return {'raw':raw,'text':raw.get('result',''),'usd':raw.get('total_cost_usd'),
            'finish':raw.get('subtype'),'model':sorted((raw.get('modelUsage') or {}).keys()),'exit':proc.returncode}


class Recorder:
    def __init__(self, offline=False):
        OUT.mkdir(parents=True,exist_ok=True)
        self.offline=offline; self.lock=threading.RLock()
        self.path=OUT/'calls.jsonl'; self.spend_path=OUT/'spend.jsonl'
        self.rows=lines(self.path)
        self.answers={}
        for row in self.rows:
            if row.get('answer') is not None:self.answers.setdefault(row['key'],row)
        self.keylocks={}

    @contextlib.contextmanager
    def exclusive(self):
        with (OUT/'run.lock').open('a') as f:
            fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
            try:yield self
            finally:fcntl.flock(f,fcntl.LOCK_UN)

    def spend(self):
        latest={x['attempt']:x for x in lines(self.spend_path)}
        return sum(x['usd'] if x.get('usd') is not None else x['reserved'] for x in latest.values())

    def call(self, model, question):
        req=request(model,question); key=client.digest(req)
        with self.lock:lk=self.keylocks.setdefault(key,threading.Lock())
        with lk:
            if key in self.answers:return self.answers[key]
            previous=[x for x in self.rows if x['key']==key]
            if previous:return previous[-1]  # no duplicate after an uncertain transport outcome
            if self.offline:raise RuntimeError('Offline recording miss: '+key)
            reserve=.50 if model=='sonnet' else (len(json.dumps(req).encode())+100)*2.5/1e6+MAX_OUTPUT*10/1e6
            with self.lock:
                if self.spend()+reserve>CAP:raise RuntimeError('Budget cap: no call sent')
                append(self.spend_path,{'attempt':key,'model':model,'reserved':reserve})
                row={'key':key,'request':req,'model':model,'answer':None,'error':'started','time':time.time()}
                append(self.path,row);self.rows.append(row)
            start=time.monotonic()
            try:
                answer=send(model,req)
                row={**row,'answer':answer,'error':None,'seconds':time.monotonic()-start}
            except Exception as ex:
                row={**row,'error':type(ex).__name__,'seconds':time.monotonic()-start}
                if isinstance(ex,urllib.error.HTTPError):row['http']=ex.code
            with self.lock:
                append(self.path,row);self.rows.append(row)
                if row['answer'] is not None:
                    self.answers[key]=row
                    append(self.spend_path,{'attempt':key,'model':model,'reserved':reserve,'usd':row['answer'].get('usd')})
                elif row.get('http'):
                    append(self.spend_path,{'attempt':key,'model':model,'reserved':reserve,'usd':0.})
            return row


def setup():
    r.setup_client()
    # Reuse every old S1 answer, but new calls belong to this round only.
    old=client._cache['jev.jsonl']
    own=OUT/'recordings';own.mkdir(parents=True,exist_ok=True)
    for x in lines(own/'jev.jsonl'):
        if x.get('answer') is not None:old.setdefault(x['key'],x)
    client.REC=str(own)


def collect_one(i, model, rec, rebuild=False):
    path=signal_path(i,model)
    if path.exists() and not rebuild:return get(i,model)
    row=rec.call(model,i['question']);answer=row.get('answer') or {}
    parsed=first_object(answer.get('text')) or {}
    reference=str(parsed.get('final_answer',''))[:600]
    ctx=r.Ctx(i,rec.offline); p=None
    if reference:
        p=ctx.jev({'request':i['question'],'reference_answer':reference,'reply':i['a']},{'match':MATCH})['match']
    raw=answer.get('raw') or {}
    resolved=answer.get('model')
    right_model=(isinstance(resolved,str) and resolved.startswith(MODELS[model])) if model=='sol' else bool(resolved and all(x.startswith(MODELS[model]) for x in resolved))
    healthy=bool(reference and p is not None and right_model and answer.get('usd') is not None
                 and answer.get('finish') in ('stop','success') and not raw.get('is_error'))
    sig={'pA':p,'detail':{'reference':reference,'confidence':parsed.get('confidence')},
         'healthy':healthy,'solver_key':row['key'],
         'usage':[{'provider':model,'key':row['key'],'count':1,'usd':answer.get('usd') or 0,'seconds':row.get('seconds',0)}]+ctx.calls}
    if rebuild:
        expected=get(i,model)
        assert sig==expected,(model,i['id'],'raw replay differs')
    else:r.save(path,sig)
    return sig


def probes():
    ordered=sorted(v.items('tune'),key=lambda i:(len(i['question']),i['id']))
    return [ordered[round(k*(len(ordered)-1)/9)] for k in range(10)]


def collect(phase, offline=False):
    setup();rec=Recorder(offline)
    if phase!='probes':
        health=json.loads((OUT/'probe-report.json').read_text())
        assert all(health[m]['healthy']==10 for m in MODELS),'Ten healthy probes per solver required'
    if phase=='valid':
        cfg=json.loads(CONFIG.read_text());assert cfg['source_sha256']==sha(__file__)
    items=probes() if phase=='probes' else v.items(phase)
    jobs=[(i,m) for i in items for m in MODELS]
    with rec.exclusive(),ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda job:collect_one(*job,rec),jobs))
    if phase=='probes':
        report={}
        for m in MODELS:
            sigs=[get(i,m) for i in items]
            usd=sum(x['usage'][0]['usd'] for x in sigs)
            report[m]={'healthy':sum(x['healthy'] for x in sigs),'n':len(sigs),'usd':usd,
                       'projection_95_usd':usd*95/len(sigs),'ids':[i['id'] for i in items]}
        report['budget_accounted_usd']=rec.spend();r.save(OUT/'probe-report.json',report)
        print(json.dumps(report),flush=True)
    else:print(json.dumps({'half':phase,'items_per_model':len(items),'accounted_usd':rec.spend()}),flush=True)


def signals(items, model):
    if model=='luna':
        stores=r.load_stores()
        return {r.key(i):r.old_signal(i,'pw_ref_luna',stores) for i in items}
    return {r.key(i):get(i,model) for i in items}


def decisions(sigs, threshold):
    return {k:{'pA':s['pA'],'verdict':('missing' if s['pA'] is None else 'A' if s['pA']>=threshold else 'B'),
               'usage':s.get('usage',[])} for k,s in sigs.items()}


def select(items, sigs):
    points=[{'threshold':cut,**r.metrics(items,decisions(sigs,cut))}
            for cut in sorted({0.,1.01,*[s['pA'] for s in sigs.values() if s['pA'] is not None]})]
    return max([p for p in points if p['sensitivity']>=.5],key=lambda p:(p['accuracy'],p['balanced'],p['threshold']))


def fit():
    assert not CONFIG.exists(),'Frozen fit is immutable'
    assert not (OUT/'signals/sol').exists() or all(not signal_path(i,m).exists() for i in v.items('valid') for m in MODELS)
    items=v.items('tune');result={};cfg={'selection':SELECTION,'split_version':r.SPLIT_VERSION,
       'tuning_keys':[r.key(i) for i in items],'source_sha256':sha(__file__),'models':{},'frozen_at':time.time()}
    for m in ('luna',*MODELS):
        sigs=signals(items,m);picked=select(items,sigs);folds={};oof={}
        for f in range(5):
            train=[i for i in items if t.fold(i)!=f]
            cut=select(train,{r.key(i):sigs[r.key(i)] for i in train})['threshold'];folds[f]=cut
            held={r.key(i):sigs[r.key(i)] for i in items if t.fold(i)==f}
            oof.update(decisions(held,cut))
        result[m]={'selected':picked,'fold_thresholds':folds,'oof':r.metrics(items,oof)}
        cfg['models'][m]={'threshold':picked['threshold'],'tuning_signals_sha256':client.digest(sigs)}
    r.save(CONFIG,cfg);r.save(OUT/'tuning.json',result)
    print(json.dumps(result),flush=True)


def report():
    cfg=json.loads(CONFIG.read_text());assert cfg['source_sha256']==sha(__file__)
    items=v.items('valid');audit=json.loads((r.OUT/'label-audit/report.json').read_text())
    edits={x['id']:x['corrected_label'] for x in audit['corrections']}
    corrected=[{**i,'label':edits.get(i['id'],i['label'])} for i in items]
    boards={};all_ds={}
    for m in ('luna',*MODELS):
        sigs=signals(items,m)
        for mode,cut in [('fitted',cfg['models'][m]['threshold']),('fixed_0.5',.5)]:
            name=m+' '+mode;ds=decisions(sigs,cut)
            if mode=='fixed_0.5':
                ds={k:{**d,'verdict':r.verdict(d['pA']) if d['pA'] is not None else 'missing'} for k,d in ds.items()}
            all_ds[name]=ds
    all_ds['always_fail']={r.key(i):{'verdict':'B','usage':[]} for i in items}
    for name,ds in all_ds.items():
        official=r.metrics(items,ds);corr=r.metrics(corrected,ds)
        boards[name]={'official':official,'corrected':corr,
                     'bar_met':100*(official['accuracy']-42/49)>3.3 and official['sensitivity']>0}
    result={'n':len(items),'boards':boards,'config_sha256':sha(CONFIG),'label_audit_sha256':sha(r.OUT/'label-audit/report.json'),
            'noise_floor_points':3.3,'required_correct':44,'spend_usd':Recorder(True).spend()}
    r.save(OUT/'validation-decisions.json',all_ds);r.save(OUT/'validation.json',result)
    print(json.dumps(result),flush=True)


def replay():
    # Network is forbidden even if a future refactor accidentally asks for it.
    def blocked(*a,**k):raise AssertionError('Network disabled')
    client._post=blocked
    setup();rec=Recorder(True)
    for i in v.items('tune')+v.items('valid'):
        for m in MODELS:collect_one(i,m,rec,rebuild=True)
    cfg=json.loads(CONFIG.read_text())
    for m in ('luna',*MODELS):
        ss=signals(v.items('tune'),m)
        assert client.digest(ss)==cfg['models'][m]['tuning_signals_sha256']
        assert select(v.items('tune'),ss)['threshold']==cfg['models'][m]['threshold']
    answered=[x for x in rec.rows if x.get('answer') is not None]
    assert len({x['key'] for x in answered})==len(answered)==190
    assert rec.spend()<=CAP
    before=sha(OUT/'validation.json');report();assert before==sha(OUT/'validation.json')
    r.save(OUT/'verification.json',{'raw_solver_answers_replayed':190,'signals_replayed':190,
        'network_disabled':True,'returned_answers_unique':True,'fitted_on_tuning_only':True,'spend_usd':rec.spend()})


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['probes','tune','valid','fit','report','replay']);p.add_argument('--offline',action='store_true');a=p.parse_args()
    if a.command in ('probes','tune','valid'):collect(a.command,a.offline)
    else:globals()[a.command]()

if __name__=='__main__':main()
