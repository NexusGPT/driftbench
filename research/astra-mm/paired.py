"""Paired complete-cohort estimates. No fitting, calls or imputation of missing panels."""
import collections,json,math,pathlib,sys
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parent
D=ROOT/'data'
GROUPS=['reasoning','chat','linguistics','language mixing','safety']
def rows(path):return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
def estimate(rs,kind='macro5'):
 groups=[g for g in GROUPS if any(r['group']==g for r in rs)]
 if kind=='macro5' and groups!=GROUPS:raise ValueError('The official five-subset macro needs all five subsets')
 n=len(rs)
 if not n:return {'n':0}
 by={g:np.array([(r['base'],r['cascade']) for r in rs if r['group']==g]) for g in groups}
 weights={g:(1/len(groups) if kind=='macro5' else len(a)/n) for g,a in by.items()}
 tb=sum(weights[g]*a[:,0].mean() for g,a in by.items())*100
 tc=sum(weights[g]*a[:,1].mean() for g,a in by.items())*100
 rng=np.random.default_rng(20261013);diffs=np.zeros(20000)
 for g,a in by.items():
  delta=a[:,1]-a[:,0]
  # Batches avoid unnecessary peak memory while preserving the seeded resampling sequence.
  for start in range(0,20000,1000):
   idx=rng.integers(0,len(a),size=(min(1000,20000-start),len(a)))
   diffs[start:start+len(idx)]+=weights[g]*delta[idx].mean(axis=1)*100
 lo,hi=np.percentile(diffs,[2.5,97.5])
 wins=sum(r['cascade']>r['base'] for r in rs);losses=sum(r['cascade']<r['base'] for r in rs)
 m=wins+losses;k=min(wins,losses);p=min(1,2*sum(math.comb(m,i) for i in range(k+1))/2**m) if m else 1
 return {'n':n,'metric':'five-subset macro' if kind=='macro5' else 'item mean among full-panel escalations only','base':float(tb),'cascade':float(tc),'difference':float(tc-tb),'paired95':[float(lo),float(hi)],'wins':wins,'losses':losses,'unchanged':n-m,'signTestP':p,'subsets':{g:{'n':len(by[g]),'base':float(by[g][:,0].mean()*100),'cascade':float(by[g][:,1].mean()*100),'difference':float((by[g][:,1]-by[g][:,0]).mean()*100)} if g in by else {'n':0,'base':None,'cascade':None,'difference':None} for g in GROUPS}}
if __name__=='__main__':
 prefix=sys.argv[1] if len(sys.argv)>1 else 'dev'
 complete=rows(D/f'{prefix}-decisions.jsonl');full=rows(D/f'{prefix}-full-panel-decisions.jsonl');excluded=json.loads((D/f'{prefix}-excluded.json').read_text())
 expected=len(json.loads((D/f'{prefix}.json').read_text()))
 is_full=len(complete)==expected and not excluded
 out={'label':f'Full {expected:,}-item {prefix.upper()} replication' if is_full else 'Partial replication: complete cases only; missing panels excluded from both paired arms','completeCascadeCohort':estimate(complete),'fullPanelEscalationsOnly':estimate(full,'item'),'excludedItems':len(excluded),'testGateEvaluated':is_full and prefix=='dev','reason':f'Frozen {prefix.upper()} cohort complete.' if is_full else 'Frozen 1,052-item DEV replication is incomplete; partial estimates do not authorize TEST.','bootstrap':{'draws':20000,'seed':20261013,'strata':'subset','percentiles':[2.5,97.5],'note':'The complete-cascade cohort includes Haiku agreements with no panel required, plus escalations with all panel requests recorded. The strict full-panel cohort contains only the latter.'}}
 if is_full and prefix=='dev':
  a=out['completeCascadeCohort'];out['testGatePassed']=a['difference']>=1.0 and a['paired95'][0]>0
 (D/(('paired-full.json' if is_full else 'paired-partial.json') if prefix=='dev' else f'{prefix}-paired.json')).write_text(json.dumps(out,indent=2)+'\n')
 print(json.dumps(out,indent=2))
