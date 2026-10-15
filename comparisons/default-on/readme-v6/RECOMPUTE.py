"""Recompute published default outcomes, paired tests, costs and chart JSON without model calls or input bodies."""
import argparse,hashlib,json,math
from collections import defaultdict
from pathlib import Path
HISTORICAL='unverified historical (lane report)'
PEERS=('promptfoo','deepeval','inspect','langfuse','langwatch')
BENCHES=('judgebench','mmeval','rubricbench','verify','writing')
MM_GROUPS=('chat','reasoning','safety','linguistics','language mixing')
EXPECTED_COUNTS={'judgebench':270,'mmeval':600,'rubricbench':790,'verify':221,'writing':173}
def sha_bytes(x):return hashlib.sha256(x).hexdigest()

def sha_file(p):return sha_bytes(Path(p).read_bytes())

def digest(x):return sha_bytes(json.dumps(x,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode())

def read_json(p):return json.loads(Path(p).read_text())

def jsonl(p):return [json.loads(l) for l in Path(p).read_text().split('\n') if l.strip()]  # split only on newline: raw provider text may hold U+2028

def exact(w,l):
 n=w+l
 return min(1.,2*sum(math.comb(n,k) for k in range(min(w,l)+1))/2**n) if n else 1.

def holm(rows,key='p',out='holmP'):
 running=0
 for rank,i in enumerate(sorted(range(len(rows)),key=lambda i:rows[i][key])):
  running=max(running,min(1.,rows[i][key]*(len(rows)-rank)));rows[i][out]=running
  if out=='holmP':rows[i]['verdict']='WIN' if running<.05 and rows[i]['wins']>rows[i]['losses'] else 'LOSS' if running<.05 and rows[i]['losses']>rows[i]['wins'] else 'TIE'

def wilson(k,n):
 if not n:return None
 z=1.959963984540054;p=k/n;d=1+z*z/n;c=(p+z*z/(2*n))/d;h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
 return [c-h,c+h]

def index_unique(rows,key):
 out={}
 for r in rows:
  k=key(r)
  if k in out:raise ValueError('Duplicate identity: '+str(k))
  out[k]=r
 return out

def values(bench,items,decisions):
 """Fixed denominator; historical missing rows are wrong, not dropped."""
 unit=[];clusters=[]
 for x in items:
  d=decisions.get(x['id']);games=d.get('games',[]) if d else []
  if bench=='verify':v=int(d is not None and d.get('pass') is not None and d['pass']==x['label']);unit.append(v);clusters.append(v)
  elif bench=='judgebench':
   v=int(sum(1 if g==x['label'] else -1 if g in ('A','B') else 0 for g in games)>0) if len(games)==2 else 0;unit.append(v);clusters.append(v)
  elif bench=='mmeval':
   v=sum(1 if g==x['label'] else .5 if g=='tie' else 0 for g in games)/2 if len(games)==2 else 0;unit.append(v);clusters.append(v)
  else:
   v=[int(g==x['label']) for g in games] if len(games)==2 else [0,0];unit+=v;clusters.append(sum(v)/2)
 return unit,clusters

def metric(bench,items,decisions):
 unit,clusters=values(bench,items,decisions)
 if bench=='mmeval':
  group=defaultdict(list)
  for x,v in zip(items,unit):group[x['group']].append(v)
  if set(group)!=set(MM_GROUPS):raise ValueError('MM-Eval must include exactly five nonempty core groups')
  return {'n':len(items),'score':sum(sum(group[g])/len(group[g]) for g in MM_GROUPS)/5,'byGroup':{g:{'n':len(group[g]),'score':sum(group[g])/len(group[g])} for g in MM_GROUPS}}
 return {'n':len(unit),'correct':sum(unit),'score':sum(unit)/len(unit),'wilson95':wilson(sum(unit),len(unit))}

def compare(bench,items,ours,peer):
 a,ac=values(bench,items,ours);b,bc=values(bench,items,peer);wins=sum(x>y for x,y in zip(a,b));losses=sum(x<y for x,y in zip(a,b));cw=sum(x>y for x,y in zip(ac,bc));cl=sum(x<y for x,y in zip(ac,bc))
 return {'wins':wins,'losses':losses,'p':exact(wins,losses),'ours':metric(bench,items,ours),'peer':metric(bench,items,peer),'itemClusterSensitivity':{'wins':cw,'losses':cl,'p':exact(cw,cl)},'historicalQualification':HISTORICAL}

def load_peers(bench):
 base=R/'examples/all-peers-public';recorded=read_json(base/f'data/{bench}/recorded.json');out={'promptfoo':recorded['promptfoo']};sources=[{'path':f'examples/all-peers-public/data/{bench}/recorded.json','sha256':sha_file(base/f'data/{bench}/recorded.json')}]
 for peer in PEERS[1:]:
  rel=f'examples/all-peers-public/cells/{bench}/{peer}/decisions.jsonl';p=R/rel;rows=jsonl(p);out[peer]=index_unique(rows,lambda x:x['id']);sources.append({'path':rel,'sha256':sha_file(p)})
 return out,sources

def primary_cohort(bench,items,provenance):
 if bench!='mmeval':return items
 missing=provenance['recordedCheck']['primaryMissingIds']
 if len(missing)!=9 or len(set(missing))!=9 or not set(missing)<=set(i['id'] for i in items):raise ValueError('MM-Eval primary exclusions mismatch')
 primary=[i for i in items if i['id'] not in set(missing)]
 if len(primary)!=591:raise ValueError('MM-Eval primary denominator mismatch')
 return primary

def chart_payloads(scores,metadata,always_fail,longer):
 charts={}
 s=scores['judgebench'];charts['judgebench']={'metadata':metadata,'cells':[{'model':metadata['model'],'status':'MEASURED','n':s['items'],'ledger':{'correct':s['primary']['correct']},'promptfoo':{'correct':s['comparators']['promptfoo']['primary']['correct']}}]}
 s=scores['mmeval'];charts['mm-eval']={'metadata':metadata,'planned':600,'models':{'haiku':{'primary':{'matched':s['primary']['n'],'scores':{'ledger':s['primary']['score'],'promptfoo':s['comparators']['promptfoo']['primary']['score']}},'registeredAllIn':{'matched':s['all']['n'],'scores':{'ledger':s['all']['score'],'promptfoo':s['comparators']['promptfoo']['all']['score']}}}}}
 s=scores['rubricbench'];charts['rubricbench-haiku']={'metadata':metadata,'cells':[{'model':metadata['model'],'coverage':{'complete':True},'stats':{'pairs':s['items'],'ours':{'estimate':s['primary']['score']},'peer':{'estimate':s['comparators']['promptfoo']['primary']['score']}}}]}
 s=scores['verify'];charts['verify']={'metadata':metadata,'cheaters':{'alwaysFailOfficial':always_fail},'cells':[{'model':'haiku','official':{'correct':[s['primary']['correct'],s['comparators']['promptfoo']['primary']['correct']],'matchedItems':s['items']}}]}
 s=scores['writing']
 charts['writing']={'metadata':metadata,'cells':[{'model':'haiku','contestant':'pair-ledger','status':'complete','pairs':s['items'],'accuracy':s['primary']['score']*100},{'model':'haiku','contestant':'promptfoo','status':'complete','pairs':s['items'],'accuracy':s['comparators']['promptfoo']['primary']['score']*100,'qualification':HISTORICAL},{**longer,'status':'complete','qualification':HISTORICAL}]}
 return charts

def recompute(report_path,outcomes_path,repo):
 global R
 report=read_json(report_path);public=read_json(outcomes_path);metadata=report['metadata']
 if metadata!=public['metadata']:raise ValueError('Metadata mismatch')
 if metadata['policy']!='default-on-v6' or metadata['model']!='claude-haiku-5-5':raise ValueError('Policy/model mismatch')
 idx=index_unique(public['items'],lambda x:(x['bench'],x['id']))
 if len(idx)!=2054 or metadata['population']!=2054 or metadata['returned']!=2054:raise ValueError('Coverage mismatch')
 required_sources={f'examples/all-peers-public/data/{b}/{f}.json' for b in BENCHES for f in ('recorded','provenance')}|{f'examples/all-peers-public/cells/{b}/{p}/decisions.jsonl' for b in BENCHES for p in PEERS[1:]}|{'docs/assets/data/sealed/writing.json'}
 sources=index_unique(report['sources'],lambda s:s['path'])
 if set(sources)!=required_sources:raise ValueError('Historical source inventory mismatch')
 for s in sources.values():
  if sha_file(repo/s['path'])!=s['sha256']:raise ValueError('Historical source changed')
 required_flags={'unparsed','providerBlock','truncated','refusal','blocked','declineReason','defaultFailure','providerReceiptDecline'}
 for x in public['items']:
  flags=x.get('validityFlags')
  if not isinstance(flags,dict) or set(flags)!=required_flags or any(type(v) is not bool for v in flags.values()) or type(x.get('valid')) is not bool or x['valid']!=(not any(flags.values())):raise ValueError('Inconsistent public validity flags')
  if x['bench']=='verify':
   if x['gold'] not in ('pass','fail') or x['finalWinner'] not in ('pass','fail','inconclusive') or x.get('games') is not None:raise ValueError('Invalid verify enum')
   expected=(x['finalWinner']=='pass') if x['valid'] and x['finalWinner'] in ('pass','fail') else None
   if x.get('pass') is not expected:raise ValueError('Invalid verify pass type/value')
  else:
   if x['gold'] not in ('A','B') or x['finalWinner'] not in ('A','B','tie','inconclusive',None) or x.get('pass') is not None:raise ValueError('Invalid pair enum')
   games=x.get('games')
   if not isinstance(games,list) or len(games)!=2 or (x['valid'] and (x['finalWinner'] is None or any(g not in ('A','B','tie') for g in games))) or (not x['valid'] and games!=[None,None]):raise ValueError('Invalid pair readings')
   if x['valid'] and 'readings' in x:
    if not isinstance(x['readings'],list) or len(x['readings'])!=2 or any(type(v) is not int for v in x['readings']) or x['readings']!=[{'A':1,'B':-1,'tie':0}[g] for g in games]:raise ValueError('Public reading sign mismatch')
 R=repo;computed=[]
 for bench in BENCHES:
  rows=[x for x in public['items'] if x['bench']==bench]
  if len(rows)!=EXPECTED_COUNTS[bench]:raise ValueError('Benchmark denominator mismatch')
  items=[{'id':x['id'],'group':x['group'],'label':x['gold']=='pass' if bench=='verify' else x['gold']} for x in rows];ours={x['id']:x for x in rows}
  peers,_=load_peers(bench);prov=read_json(repo/f'examples/all-peers-public/data/{bench}/provenance.json');primary=primary_cohort(bench,items,prov)
  got=report['benchmarks'][bench]
  if metric(bench,primary,ours)!=got['primary'] or metric(bench,items,ours)!=got['all']:raise ValueError('Primary/all score mismatch: '+bench)
  final=sum(x['valid'] and x['finalWinner']==x['gold'] for x in rows)
  if got['aggregateFinalWinner']!={'correct':final,'n':len(rows),'score':final/len(rows)}:raise ValueError('Aggregate score mismatch: '+bench)
  if got['unscored']!=sum(not x['valid'] for x in rows):raise ValueError('Validity mismatch')
  if bench!='verify':
   strict={'correct':sum(x['games']==[x['gold'],x['gold']] for x in rows),'n':len(rows)}
   if got['strictBothOrders']!=strict:raise ValueError('Strict both-order score mismatch')
  if set(got['comparators'])!=set(PEERS):raise ValueError('Comparator inventory mismatch')
  for name,peer in peers.items():
   expected={'primary':metric(bench,primary,peer),'all':metric(bench,items,peer),'missing':sum(x['id'] not in peer for x in items),'qualification':HISTORICAL}
   if got['comparators'][name]!=expected:raise ValueError('Comparator summary mismatch')
   computed.append({'bench':bench,'peerName':name,**compare(bench,primary,ours,peer)})
 holm(computed);holm([x['itemClusterSensitivity'] for x in computed],out='sensitivityHolmP')
 if computed!=report['comparisons']:raise ValueError('Paired statistics mismatch')
 receipts=read_json(Path(report_path).with_name('receipt-provenance.json'))
 if receipts['metadata']!=metadata:raise ValueError('Receipt metadata mismatch')
 physical=index_unique(receipts['physical'],lambda x:x['call'])
 for x in physical.values():
  if type(x.get('unknown')) is not bool:raise ValueError('Invalid unknown flag')
  amount=x.get('retainedReserveUsd') if x['unknown'] else x.get('costUsd')
  if type(amount) not in (int,float) or not math.isfinite(amount) or amount<0:raise ValueError('Invalid public charge amount')
  if x['unknown'] and x.get('costUsd') is not None:raise ValueError('Unknown charge has known cost')
  if not x['unknown'] and x.get('retainedReserveUsd')!=0:raise ValueError('Known charge also retained as unknown')
 actual=sum(x.get('costUsd') or 0 for x in physical.values());unknown=sum(x['retainedReserveUsd'] for x in physical.values() if x['unknown'])
 if not math.isclose(actual,metadata['actualCostUsd'],abs_tol=1e-10) or not math.isclose(unknown,metadata['retainedUnknownUsd'],abs_tol=1e-10):raise ValueError('Public receipt cost mismatch')
 if len(physical)!=metadata['physicalCalls'] or len(receipts['reused'])!=metadata['reusedPhysicalCalls']:raise ValueError('Public receipt coverage mismatch')
 if sum(x['reuseKind']=='historical-replay' for x in receipts['reused'])!=metadata['historicalReplayCalls'] or sum(x['reuseKind']=='replay' for x in receipts['reused'])!=metadata['localCacheReplayCalls']:raise ValueError('Reuse kind mismatch')
 verify=[x for x in public['items'] if x['bench']=='verify'];always_fail=sum(x['gold']=='fail' for x in verify)/len(verify)
 longer=next(x for x in read_json(repo/'docs/assets/data/sealed/writing.json')['cells'] if x['contestant']=='longer-wins')
 charts=chart_payloads(report['benchmarks'],metadata,always_fail,longer)
 for name,expected in charts.items():
  if read_json(Path(report_path).with_name(name+'.json'))!=expected:raise ValueError('Chart payload mismatch: '+name)
 return {'status':'PASS','items':len(idx),'primaryComparisons':len(computed),'paidCalls':0}
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('directory',type=Path);ap.add_argument('--repo',type=Path,required=True);a=ap.parse_args();print(json.dumps(recompute(a.directory/'results.json',a.directory/'outcomes.json',a.repo.resolve())))
