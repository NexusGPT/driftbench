"""Two independent System-1 calls: commit first, route only after abstention.

All live System-1 calls use unchanged moj.client at three concurrent requests.
Only named practice files are read. No labels or benchmark IDs enter prompts.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import numpy as np
from . import pointwise_router as r
from .confidence import Isotonic

OUT=r.OUT/'two-step'
CONFIG=r.ROOT/'configs/pw-two-step-frozen.json'
GRID=[.5,.6,.7,.8,.9,.95,.99,1.,1.01]
ROUTER={
 'reference': 'Is an explicit answer or source reference supplied, rather than only a rubric?',
 'rubric': 'Does this item supply a criterion or rubric with requirements to check?',
 'pair': 'Are there two candidate replies to compare?',
 'reasoning': 'Does deciding correctness require solving arithmetic, mathematical reasoning, logic or code execution?',
 'subjective': 'Is the task mainly subjective writing or style preference?',
 'reference_solution': 'Is the supplied reference a worked solution whose final answer should be compared, rather than a factual source whose details must not be contradicted?',
 'compound_rubric': 'Must every separate requirement in a compound rubric hold for a reply to pass?',
 's1_reference': 'Is a whole-answer System-1 comparison against supplied reference evidence the right judge design?',
 's2_solve_compare': 'Should a reasoning model first solve the problem without seeing the candidate, then System 1 compare final answers?',
 's2_full': 'Does this item need a full reasoning judge to interpret requirements or detect contradictions?',
 's1_rows': 'Can explicit rubric questions be checked by System 1 and aggregated without an independent solution?',
}

def population(half):
    items=r.rows(half,True)
    if half=='tune':
        # Both Verify modes share labels but have different fixed group splits.
        # Purge tuning copies of every validation ID in either Verify mode.
        validation={i['id'] for i in r.rows('valid',True) if i['bench'].startswith('verify')}
        items=[i for i in items if not i['bench'].startswith('verify') or i['id'] not in validation]
    return items


def shape(i):
    return 'pair' if i['kind']=='pair' else 'reference' if r.carried(i)=='reference' else 'rubric' if r.carried(i) in ('rubric','rows') else 'question'


def path(i,stage):
    return OUT/'signals'/stage/(hashlib.sha256(r.key(i).encode()).hexdigest()+'.json')


def get(i,stage):
    p=path(i,stage)
    return json.loads(p.read_text()) if p.exists() else None


def collect_one(i,stage,offline):
    found=get(i,stage)
    if found is not None:return found
    ctx=r.Ctx(i,offline)
    if stage=='commit':
        commit='Can you commit to the requested judgment using the supplied evidence, without guessing an unknown fact or performing uncertain reasoning? Answer no if an independent solution or expert interpretation is needed. A commitment can be either pass or fail.'
        if i['kind']=='pair':
            q={'a_better':'Does the first reply satisfy the supplied rubric better than the second reply?',
               'b_better':'Does the second reply satisfy the supplied rubric better than the first reply?', 'can_commit':commit}
        else:
            ask=('Does the reply agree with the supplied reference on the decisive final answer or facts, allowing equivalent wording?' if shape(i)=='reference' else
                 'Does the reply satisfy every supplied requirement of the rubric?' if shape(i)=='rubric' else
                 'Is the final answer in the reply correct?')
            q={'pass':ask,'can_commit':commit}
        a=ctx.jev(r.payload(i),q)
        p=((a['a_better']+1-a['b_better'])/2 if a.get('a_better') is not None and a.get('b_better') is not None else None) if i['kind']=='pair' else a['pass']
        result={'pA':p,'detail':a,'usage':ctx.calls}
    else:
        a=ctx.jev(r.payload(i),ROUTER)
        result={'pA':None,'detail':a,'usage':ctx.calls}
    r.save(path(i,stage),result)
    return result


def group(i):
    return ('verify:'+i['id']) if i['bench'].startswith('verify') else r.group_key(i)


def fold(i):
    return int(hashlib.sha256(('two-step:'+group(i)).encode()).hexdigest(),16)%5


def raw_conf(s):
    p=s['pA'];a=s['detail'].get('can_commit')
    return 0. if p is None or a is None else max(p,1-p)*a


def calibrate(items,stores=None,expert=None):
    maps={}
    for c in ('pair','reference','rubric','question'):
        samples=[]
        for i in items:
            if shape(i)!=c:continue
            s=get(i,'commit') if expert is None else r.old_signal(i,expert,stores)
            p=s['pA']
            if p is not None:
                x=raw_conf(s) if expert is None else max(p,1-p)
                samples.append((x,r.score_verdict(r.verdict(p),i['label'])))
        if samples:maps[c]=Isotonic.fit(*zip(*samples)).to_dict()
    return maps


def conf(i,s,maps,commit=False):
    m=maps.get(shape(i))
    if m is None or s['pA'] is None:return 0.
    x=raw_conf(s) if commit else max(s['pA'],1-s['pA'])
    return float(Isotonic(m['x'],m['y']).predict(x))


def committed(i,cfg,maps=None):
    s=get(i,'commit')
    c=conf(i,s,maps if maps is not None else cfg['commit_maps'],True)
    ok=(shape(i)!='question' and r.verdict(s['pA'])!='tie' and c>=cfg['commit_threshold'])
    return ok,c


def bucket(i):
    t=get(i,'route')['detail'];c=shape(i)
    if c=='reference':return 'reference_solution' if (t.get('reference_solution') or 0)>=.5 else 'reference_facts'
    if c=='rubric':return 'rubric_compound' if (t.get('compound_rubric') or 0)>=.5 else 'rubric_simple'
    return c


def menu(b):
    if b.startswith('reference'):return ('pw_whole','reference')
    if b=='question':return ('pw_ref_luna',)
    return ('pw_rows','pw_whole')


def expert_signal(i,name,stores):
    return r.get_signal(i,'reference') if name=='reference' else r.old_signal(i,name,stores)


def stage2(i,stores,cfg,expert_maps,policy=None):
    b=bucket(i)
    rule=policy or cfg['routing'][b]
    name=rule['expert'];s=expert_signal(i,name,stores)
    maps=expert_maps[name]
    c=conf(i,s,maps)
    route=get(i,'route')
    used=list(route['usage'])+s['usage'];path=['route',name]
    p=s['pA']
    if p is None or c<rule['threshold']:
        full=r.old_signal(i,'pw_s2v_luna',stores)
        used+=full['usage'];path.append('pw_s2v_luna')
        if full['pA'] is not None:p=full['pA']
    return {'pA':p,'verdict':r.verdict(p),'confidence':c,'path':path,'usage':used,'level':'routed'}


def expert_maps(items,stores):
    maps={}
    for name in ('pw_rows','pw_whole','pw_ref_luna','reference'):
        samples={}
        for i in items:
            s=expert_signal(i,name,stores)
            if not s or s['pA'] is None:continue
            p=s['pA'];samples.setdefault(shape(i),[]).append((max(p,1-p),r.score_verdict(r.verdict(p),i['label'])))
        maps[name]={c:Isotonic.fit(*zip(*ss)).to_dict() for c,ss in samples.items()}
    return maps


def step1(args):
    r.setup_client();items=population('tune')
    with ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(lambda i:collect_one(i,'commit',args.offline),items))
    oof={}
    for f in range(5):
        maps=calibrate([i for i in items if fold(i)!=f])
        for i in items:
            if fold(i)==f:oof[r.key(i)]=conf(i,get(i,'commit'),maps,True)
    options=[]
    for threshold in GRID:
        eligible=[i for i in items if shape(i)!='question' and oof[r.key(i)]>=threshold and r.verdict(get(i,'commit')['pA'])!='tie']
        correct=[r.score_verdict(r.verdict(get(i,'commit')['pA']),i['label']) for i in eligible]
        # A cautious gate must earn its commitment on each observed shape.
        rates={c:[v for i,v in zip(eligible,correct) if shape(i)==c] for c in ('pair','reference','rubric')}
        safe=all(not v or (len(v)>=5 and np.mean(v)>=.98) for v in rates.values())
        options.append({'threshold':threshold,'n':len(eligible),'accuracy':float(np.mean(correct)) if correct else None,'safe':safe})
    chosen=max((x for x in options if x['safe']),key=lambda x:(x['n'],-x['threshold']))
    cfg={'name':'pw-two-step','split_version':r.SPLIT_VERSION,'commit_threshold':chosen['threshold'],'commit_maps':calibrate(items),'tuning_keys':[r.key(i) for i in items],
         'commit_selection':'Grouped OOF, maximize commitment coverage subject to >=98 percent accuracy and at least five commits in each committed shape; no-reference correctness always abstains.',
         'routing':{},'expert_maps':{},'oof_commit_confidence':oof}
    r.save(OUT/'step1.json',cfg);r.save(OUT/'commit-selection.json',options)
    # Each router collection is justified by an actual OOF or final-fit abstention.
    need=[i for i in items if not committed(i,cfg)[0] or shape(i)=='question' or oof[r.key(i)]<cfg['commit_threshold']]
    with ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(lambda i:collect_one(i,'route',args.offline),need))
    print(json.dumps({'tuning_items':len(items),'commit_threshold':cfg['commit_threshold'],'commit_options':options,'router_items':len(need)}))


def fit(args):
    items=population('tune');stores=r.load_stores(True);cfg=json.loads((OUT/'step1.json').read_text())
    r.setup_client()
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda i:r.ensure_signal(i,'reference',args.offline),[i for i in items if shape(i)=='reference']))
    routed=[i for i in items if shape(i)=='question' or cfg['oof_commit_confidence'][r.key(i)]<cfg['commit_threshold'] or r.verdict(get(i,'commit')['pA'])=='tie']
    foldmaps={f:expert_maps([i for i in items if fold(i)!=f],stores) for f in range(5)}
    candidates=[]
    for commit_threshold in GRID:
        routed=[i for i in items if shape(i)=='question' or cfg['oof_commit_confidence'][r.key(i)]<commit_threshold or r.verdict(get(i,'commit')['pA'])=='tie']
        trail={};routing={}
        for b in ('pair','reference_solution','reference_facts','rubric_compound','rubric_simple','question'):
            population_b=[i for i in routed if bucket(i)==b]
            if not population_b:
                population_b=[i for i in routed if shape(i)==('reference' if b.startswith('reference') else 'rubric' if b.startswith('rubric') else b)]
            options=[]
            for expert in menu(b):
                for threshold in [0.]+GRID:
                    ds={r.key(i):stage2(i,stores,cfg,foldmaps[fold(i)],{'expert':expert,'threshold':threshold}) for i in population_b}
                    cell=r.metrics(population_b,ds)
                    options.append({'expert':expert,'threshold':threshold,'cell':cell})
            if population_b:
                chosen=max(options,key=lambda o:(round(o['cell']['balanced'],12),-o['cell']['s2_per_100'],-o['threshold']))
            else:
                chosen={'expert':menu(b)[0],'threshold':0.,'cell':{'n':0}}
            routing[b]={k:chosen[k] for k in ('expert','threshold')};trail[b]={'items':len(population_b),'options':options,'selected':routing[b]}
        ds={};routed_keys={r.key(i) for i in routed}
        for i in items:
            if r.key(i) in routed_keys:
                ds[r.key(i)]=stage2(i,stores,{**cfg,'routing':routing},foldmaps[fold(i)])
            else:
                signal=get(i,'commit')
                ds[r.key(i)]={'verdict':r.verdict(signal['pA']),'usage':signal['usage']}
        cells={b:r.metrics([i for i in items if i['bench']==b],ds) for b in (*r.BENCHES,r.DIAGNOSTIC)}
        candidates.append({'commit_threshold':commit_threshold,'routing':routing,'routing_trail':trail,
            'cells':cells,'objective':float(np.mean([v['balanced'] for v in cells.values()])),
            's2_sum':sum(v['s2_per_100'] for v in cells.values()),'commits':len(items)-len(routed)})
    best=max(candidates,key=lambda x:(round(x['objective'],12),-x['s2_sum'],x['commits']))
    routing=best['routing'];cfg['commit_threshold']=best['commit_threshold']
    cfg['commit_selection']='Joint threshold selection using grouped OOF commitment and expert confidence; maximize four-benchmark tuning balanced accuracy, then fewer S2 calls, then more commitments. No-reference correctness always abstains.'
    cfg.update({'routing':routing,'expert_maps':expert_maps(items,stores),'name':'pw-two-step-frozen',
       'source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
       'selection':'One two-step hypothesis. Commit rule and per-content routing thresholds selected on group-disjoint tuning folds only. Both Verify modes purge tuning IDs present in either validation half.',
       'system2':'gpt-6-luna only; all available expert results reused offline'})
    r.save(CONFIG,cfg);r.save(OUT/'routing-selection.json',{'selected_commit_threshold':best['commit_threshold'],'candidates':candidates})
    print(json.dumps({'config':str(CONFIG),'routing':routing}))


def decide(i,cfg,stores,offline=True,collect=False):
    if collect:collect_one(i,'commit',offline)
    s=get(i,'commit');ok,c=committed(i,cfg)
    if ok:return {'pA':s['pA'],'verdict':r.verdict(s['pA']),'confidence':c,'path':['commit'],'usage':s['usage'],'level':'commit'}
    if collect:collect_one(i,'route',offline)
    d=stage2(i,stores,cfg,cfg['expert_maps'])
    return {**d,'path':['abstain']+d['path'],'usage':s['usage']+d['usage'],'commit_confidence':c}


def validate(args):
    cfg=json.loads(CONFIG.read_text());items=population('valid');stores=r.load_stores(True);r.setup_client()
    with ThreadPoolExecutor(max_workers=8) as pool:ds=list(pool.map(lambda i:decide(i,cfg,stores,args.offline,True),items))
    decisions={r.key(i):d for i,d in zip(items,ds)}
    r.save(OUT/'validation-decisions.json',decisions)
    cells={b:r.metrics([i for i in items if i['bench']==b],decisions) for b in (*r.BENCHES,r.DIAGNOSTIC)}
    r.save(OUT/'validation.json',{'config_digest':r.client.digest(cfg),'cells':cells,'new_s2_calls':0})
    print(json.dumps(cells,indent=2))


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['step1','fit','validate']);p.add_argument('--offline',action='store_true');args=p.parse_args()
    OUT.mkdir(parents=True,exist_ok=True)
    {'step1':step1,'fit':fit,'validate':validate}[args.command](args)

if __name__=='__main__':main()
