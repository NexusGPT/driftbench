"""Free, sealed-cohort analysis for three sides, with no pooled cohort score."""
import copy,datetime,hashlib,importlib.util,json,math,subprocess,sys
from fractions import Fraction
from pathlib import Path
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
def module(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def summarise(rows):
 out={}
 for name in ['promptfoo-rubric','langfuse-reference']:
  group=[r for r in rows if r['row']==name];w=[r['id'] for r in group if r['ours']['correct'] and not r['peer']['correct']];l=[r['id'] for r in group if not r['ours']['correct'] and r['peer']['correct']];n=len(w)+len(l)
  p=Fraction(sum(math.comb(n,k) for k in range(len(w),n+1)),2**n)
  m=min(Fraction(1),2*Fraction(sum(math.comb(n,k) for k in range(min(len(w),len(l))+1)),2**n))
  out[name]={'total':len(group),'ours_only_correct':len(w),'peer_only_correct':len(l),'ours_only_correct_ids':w,'peer_only_correct_ids':l,'both_correct':sum(r['ours']['correct'] and r['peer']['correct'] for r in group),'both_wrong':sum(not r['ours']['correct'] and not r['peer']['correct'] for r in group),'one_sided_sign_test':{'numerator':p.numerator,'denominator':p.denominator,'p':float(p)},'exact_mcnemar_two_sided':{'numerator':m.numerator,'denominator':m.denominator,'p':float(m)},'families':{}}
  for side in ['ours','peer']:
   correct=sum(r[side]['correct'] for r in group);cost=sum(r[side]['cost_usd'] for r in group)
   out[name][side]={'correct':correct,'accuracy':correct/len(group),'cost_usd':cost,'usd_per_100':cost*100/len(group),'inconclusive':sum(r[side]['prediction'] not in ['pass','fail'] for r in group)}
  for fam in sorted({r['family'] for r in group}):
   x=[r for r in group if r['family']==fam];out[name]['families'][fam]={'total':len(x),**{s:sum(r[s]['correct'] for r in x) for s in ['ours','peer']}}
 return out

def main():
 runner=module('map_runner',HERE/'run.py');commit=runner.validate_freeze()
 pf=module('pf_audit',ROOT/'comparisons/promptfoo/hard/run.py');lf=module('lf_audit',ROOT/'comparisons/langfuse/hard/run.py')
 calls=[json.loads(x) for x in (HERE/'calls.jsonl').read_text().splitlines()];starts=[json.loads(x) for x in (HERE/'starts.jsonl').read_text().splitlines()]
 prompts=json.loads((HERE/'all-prompts.json').read_text());lookup={r['request_sha256']:r for r in calls}
 assert len(calls)==len(starts)==len(lookup)==len(prompts)==1008
 assert set(lookup)=={r['request_sha256'] for r in starts}
 assert all(r['success'] and r['cost_known'] and r['preregistration_commit']==commit for r in calls)
 for p in prompts:assert all(lookup[p['request_sha256']][k]==v for k,v in p.items())
 native_calls=[r for r in calls if r['side']=='ours' or (r['side']=='peer' and r['row']=='promptfoo-rubric')]
 native=subprocess.run(['node','--import','tsx',str(HERE/'native.mts'),'score'],input=json.dumps(native_calls),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,check=True)
 decoded={r['request_sha256']:s for r,s in zip(native_calls,json.loads(native.stdout),strict=True)}
 for r in calls:
  if r['request_sha256'] in decoded:continue
  prediction=(pf.outcome(r['result'],'audit','rubric') if r['row']=='promptfoo-rubric' else lf.score('ours-audit' if r['side']=='candidate' else 'theirs',r['result'],0.5))
  decoded[r['request_sha256']]={'prediction':prediction}
 rows=[]
 for name in ['promptfoo-rubric','langfuse-reference']:
  for c in json.loads((HERE/f'{name}-cases.json').read_text()):
   label=('pass' if c['truth'] else 'fail') if 'truth' in c else c['label'];item={'row':name,'id':c['id'],'family':c.get('kind',c.get('family')),'label':label}
   for side in ['ours','peer','candidate']:
    call=next(r for r in calls if (r['row'],r['id'],r['side'])==(name,c['id'],side));s=decoded[call['request_sha256']]
    item[side]={**s,'correct':s['prediction']==label,'cost_usd':call['cost_usd'],'request_sha256':call['request_sha256']}
   item['saturation']='all-correct' if all(item[s]['correct'] for s in ['ours','peer','candidate']) else 'all-wrong' if all(not item[s]['correct'] for s in ['ours','peer','candidate']) else 'discordant'
   rows.append(item)
 for side,title in [('ours','default'),('candidate','candidate')]:
  pairs=[{k:v for k,v in r.items() if k not in ['ours','candidate']}|{'ours':r[side]} for r in rows]
  output={'procedure':title,'summary':summarise(pairs),'rows':pairs}
  (HERE/f'{title}-scores.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
 earlier=[json.loads(x) for f in [HERE.parent/'calls.jsonl',HERE.parent/'candidates/calls.jsonl'] for x in f.read_text().splitlines()]
 total=sum(r['cost_usd'] for r in calls+earlier);assert total<10
 models={m for r in calls+earlier for m in r['model_usage']};assert len(models)==1
 events=sorted([(r['started'],1) for r in calls+earlier]+[(r['finished'],-1) for r in calls+earlier]);active=maximum=0
 for _,d in events:active+=d;maximum=max(maximum,active)
 assert active==0 and maximum<=2
 first=min(datetime.datetime.fromisoformat(r['started']) for r in calls);last=max(datetime.datetime.fromisoformat(r['finished']) for r in calls)
 registered=datetime.datetime.fromisoformat(subprocess.check_output(['git','show','-s','--format=%cI',commit],cwd=ROOT,text=True).strip())
 assert registered<first and last<runner.DEADLINE
 assert first>max(datetime.datetime.fromisoformat(r['finished']) for r in earlier)
 verification={'preregistration_commit':commit,'committed_at':registered.isoformat(),'first_call':first.isoformat(),'last_call':last.isoformat(),'calls':len(calls),'max_concurrency_all_runs':maximum,'resolved_models':sorted(models),'unknown_costs':0,'failed_calls':0,'retries':0,'map_cost_usd':sum(r['cost_usd'] for r in calls),'all_runs_cost_usd':total,'saturation':{name:{mark:sum(r['row']==name and r['saturation']==mark for r in rows) for mark in ['all-correct','all-wrong','discordant']} for name in ['promptfoo-rubric','langfuse-reference']}}
 (HERE/'verification.json').write_text(json.dumps(verification,indent=2)+'\n');(HERE/'all-scores.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(verification,indent=2))
if __name__=='__main__':main()
