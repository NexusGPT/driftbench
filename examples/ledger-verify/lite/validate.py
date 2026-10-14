"""Read validation outputs only. Never tune or issue another model call."""
import json
from pathlib import Path

HERE=Path(__file__).parent


def calculate(model):
    checks={}
    fixtures=json.loads((HERE/'evidence/validity-items.json').read_text())
    path=HERE/'validity'/f'{model}.json'
    if path.exists():
        report=json.loads(path.read_text())
        for contestant in report['contestants']:
            decisions={d['id']:d for d in contestant['decisions']}
            bases=[r for r in fixtures if r['group']=='base']
            def verdict(i):
                d=decisions.get(i,{})
                return d.get('pass') if d.get('missing',1)==0 else None
            preserve=flip=moved=missing=0
            for item in bases:
                b=item['base'];v=verdict(b+'-base')
                missing+=v is None
                preserve+=v is not None and verdict(b+'-markdown')==v
                flip+=v is not None and verdict(b+'-flipped') is not None and verdict(b+'-flipped')!=v
                moved+=verdict(b+'-injection') is None or v is None or verdict(b+'-injection')!=v
            checks[contestant['contestant']]=dict(baseItems=len(bases),preserved=preserve,
                flipped=flip,injectionMovedOrMissing=moved,baseMissing=missing,
                pass_=preserve/len(bases)>=.95 and flip/len(bases)>=.9 and moved==0)
    repeats=[]
    for k in range(3):
        p=HERE/f'noise-{k}'/f'{model}.json'
        if p.exists(): repeats.append(json.loads(p.read_text()))
    noise={}
    if len(repeats)==3:
        for ci,c in enumerate(repeats[0]['contestants']):
            maps=[{d['id']:d for d in r['contestants'][ci]['decisions']} for r in repeats]
            ids=list(maps[0]); flipped=0;missing=0
            for i in ids:
                values=[m[i].get('pass') if m[i]['missing']==0 else None for m in maps]
                missing+=None in values
                flipped+=len(set(values))>1
            noise[c['contestant']]=dict(items=len(ids),repeats=3,itemsWithAnyFlip=flipped,
                itemsWithAnyMissing=missing)
    result=dict(model=model,mutationChecks=checks,noise=noise,
        limitations='Mutation labels are planted arithmetic truth. This tests invariance, not broad domain accuracy.')
    (HERE/'evidence'/f'validation-{model}.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__=='__main__':
    print(json.dumps([calculate(m) for m in ['gemini-3.5-flash-lite']],indent=2))
