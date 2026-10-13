"""Matched reference/no-reference ablation on explicit practice references.

python3 -m moj.reference_run --live --bench hardrows
python3 -m moj.reference_run --offline --bench hardrows
Each cohort is frozen separately, so later reference-bearing adapters can be added.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
from types import SimpleNamespace
from .benches import HERE, POINT_BENCHES, load_point
from .panel import stats, verdict
from .panel_clients import Recorder, digest
from .policy import score_games, score_verdict
from .reference_first import eligible, reference_first, reference_blind

DIRECTORY = Path(HERE)/'results/reference'


class Context:
    def __init__(self, item, recorder):
        self.item, self.bench, self.recorder = item, POINT_BENCHES[item['bench']], recorder
        self.records = []
    def jev(self, state, questions):
        specs = {k: {'type': 'noul', 'instructions': v} for k,v in questions.items()}
        r = self.recorder.call('jev', json.dumps(specs,sort_keys=True), json.dumps(state,ensure_ascii=False,sort_keys=True), 'reference-ablation-v1')
        self.records.append(r)
        answers = (r.get('answer') or {}).get('answers') or {}
        return {k: (answers.get(k) or {}).get('noul') for k in questions}


def population(bench):
    path = DIRECTORY/(bench+'-grouped-population.json')
    if path.exists():return json.loads(path.read_text())
    items = load_point(bench)
    rows=[]
    for item in items:
        if item['split'].lower() not in ('tuning','pilot','noise','fixtures','dev','practice','tune','valid'):
            raise ValueError('Non-practice split rejected')
        if not eligible(item):continue
        games=[g for b in item['baselines'].values() for g in b.get('games',[])]
        rows.append({'key':bench+'|'+item['id'],'id':item['id'],'half':item['half'], 'label':item['label'],
                     'low':len(set(games))>1,'low_source':'recorded-baseline-disagreement',
                     'hash':digest(item), 'cluster':item.get('split_group',item['id']), 'baselines':item['baselines']})
    if not rows:raise ValueError('No explicit dataset references: '+bench)
    path.write_text(json.dumps(rows,indent=2)+'\n')
    return rows


def collect(bench,pop,rec):
    source={i['id']:i for i in load_point(bench)}
    def one(row):
        item=source[row['id']]
        if digest(item)!=row['hash']:raise ValueError('Frozen reference input changed: '+row['key'])
        out={}
        for name,fn in [('reference-first',reference_first),('reference-blind',reference_blind)]:
            ctx=Context(item,rec)
            result=fn(ctx)
            accounting=[rec.accounting(r['key']) for r in ctx.records]
            result.update(calls=sum(a['calls'] for a in accounting),
                          usd=sum(a['usd'] for a in accounting),
                          cost_complete=all(a['cost_complete'] for a in accounting),
                          keys=[r['key'] for r in ctx.records])
            out[name]=result
        return row['key'],out
    with ThreadPoolExecutor(max_workers=8) as pool:return dict(pool.map(one,pop))


def evaluate(pop,obs):
    output={'variants':{},'decisions':{},'observations':obs,
            'fit':{'tune_n':sum(r['half']=='tune' for r in pop),'threshold':.5,
                   'note':'No fitted choices; fixed pointwise threshold, validation labels never affect prompts.'}}
    baseline_names=sorted({k for r in pop for k in r['baselines']})
    for name in ['reference-first','reference-blind']+baseline_names:
        decisions=[]
        for row in pop:
            if row['half']!='valid':continue
            if name in baseline_names:
                b=row['baselines'].get(name)
                if b is None:continue
                record={'score':score_games(b['games'],row['label']), 'calls':b.get('calls'),
                        'usd':b.get('costUsd') or 0,'cost_complete':b.get('costUsd') is not None}
            else:
                o=obs[row['key']][name]; p=o['pA']
                record={'score':0 if p is None else score_verdict(verdict(p),row['label']),
                        'calls':o['calls'],'usd':o['usd'],'cost_complete':o['cost_complete'],
                        'pA':p,'missing':p is None}
            decisions.append({'key':row['key'],'low':row['low'],'cluster':row['cluster'],**record})
        output['decisions'][name]=decisions
        output['variants'][name]={'overall':stats(decisions),'low':stats([r for r in decisions if r['low']])}
    return output


def main():
    p=argparse.ArgumentParser()
    mode=p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--live',action='store_true');mode.add_argument('--offline',action='store_true')
    p.add_argument('--bench',choices=['verify','hardrows','rubricbench'],required=True)
    args=p.parse_args();DIRECTORY.mkdir(parents=True,exist_ok=True)
    rec=Recorder(DIRECTORY,offline=args.offline)
    with rec.exclusive():
        pop=population(args.bench);obs=collect(args.bench,pop,rec);result=evaluate(pop,obs)
        path=DIRECTORY/(args.bench+'-grouped-validation.json')
        if args.offline:
            if json.loads(path.read_text())!=result:raise AssertionError('Offline reference replay differs')
            print('Offline replay matches every decision and metric.')
        else:path.write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({'fit':result['fit'],'variants':result['variants'],'budget_used_usd':rec.spend()},indent=2))


if __name__=='__main__':main()
