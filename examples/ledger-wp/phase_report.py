"""Summarize fixed pilots and dev validity without changing a contestant."""
import collections
import json
from pathlib import Path
import stats

HERE = Path(__file__).resolve().parent

def main():
    path=HERE/'results/decisions.jsonl'
    rows=[json.loads(line) for line in path.read_text().splitlines() if line]
    output={'pilot':[],'dev':[],'policy':'A failed predeclared validity criterion is reported and never tuned away. Test launch requires an explicit recorded disposition.'}
    for split in ['pilot','dev']:
        items=json.loads((HERE/'seals'/f'{split}.json').read_text())
        for model in ['haiku','gpt-6-luna']:
            for contestant in ['pair-ledger','reader-first-c50b2dc3','promptfoo']:
                selected=[x for x in rows if x['split']==split and x['model']==model and x['contestant']==contestant]
                first=[x for x in selected if x.get('sample',0)==0]
                peer=[x for x in rows if x['split']==split and x['model']==model and x['contestant']=='promptfoo' and x.get('sample',0)==0]
                report={'model':model,'contestant':contestant,**stats.summarize(items,first,peer if contestant!='promptfoo' else None)}
                report['projectedTestUsd']=report['usdPer100Pairs']*173/100 if report['usdPer100Pairs'] is not None else None
                controls={}
                for control in ['longer-wins','constant-FIRST','refusal-wins']:
                    control_rows=[x for x in rows if x['split']==split and x['contestant']==control]
                    measured=stats.summarize(items,control_rows)
                    controls[control]={'accuracy':measured['accuracy'],'judgeLeadPoints':report['accuracy']-measured['accuracy'] if report['accuracy'] is not None else None}
                report['controls']=controls
                if split=='dev':
                    by_id=collections.defaultdict(dict)
                    for row in selected:by_id[row['id']][row.get('sample',0)]=row
                    complete=[group for group in by_id.values() if set(group)=={0,1,2}]
                    flips=sum(g[s]['games'][order]!=g[0]['games'][order] for g in complete for s in [1,2] for order in [0,1])
                    denom=4*len(complete)
                    report['noise']={'completeTriplePairs':len(complete),'repeatGameFlips':flips,'comparisons':denom,'flipPercent':100*flips/denom if denom else None}
                    fixtures=items[:6]
                    report['sixFixturesThreeOfThree']={item['id']:all(s in by_id[item['id']] and all(g==item['label'] for g in by_id[item['id']][s]['games']) for s in [0,1,2]) for item in fixtures}
                    report['earnedFixtureSeat']=all(report['sixFixturesThreeOfThree'].values()) and len(complete)==30
                    report['cheaterBarPass']=len(first)==30 and all(c['judgeLeadPoints'] is not None and c['judgeLeadPoints']>=10 for c in controls.values() if c['accuracy']>50)
                    report['labelPreservingEdits']='pending separately sealed cases'
                    report['labelFlippingEdits']='pending separately sealed cases'
                output[split].append(report)
    (HERE/'results/phase-report.json').write_text(json.dumps(output,indent=2)+'\n')
    print(json.dumps(output,indent=2))

if __name__=='__main__':main()
