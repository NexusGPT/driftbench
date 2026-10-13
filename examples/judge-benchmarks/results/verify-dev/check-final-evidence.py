"""Independent protocol and arithmetic checks. No model calls or source mutations."""
import json,math,hashlib,subprocess
from pathlib import Path
from fractions import Fraction
from datetime import datetime,timezone
P=Path(__file__).resolve().parent
R=P.parents[3]
load=lambda name:json.loads((P/(name+'.json')).read_text())
f=load('freeze');m=load('test-metrics');s=load('test-selection');t=load('test-result');a=load('test-label-audit')
checks={}
checks['frozen_hashes']=all(hashlib.sha256((R/p).read_bytes()).hexdigest()==h for p,h in f['hashes'].items())
subprocess.run(['git','merge-base','--is-ancestor',f['sha'],'HEAD'],cwd=R,check=True)
items=a['items'];byid={x['id']:x for x in items}
stratum=lambda x:('correct' if x['correct'] else 'incorrect')+(':'+('long' if len(x['response'].encode('utf-16-le'))//2>10000 else 'short'))
groups={}
for x in items:groups.setdefault(stratum(x),[]).append(x)
def sample(n):
    quotas={g:Fraction(len(xs)*n,len(items)) for g,xs in groups.items()}
    takes={g:int(q) for g,q in quotas.items()}
    left=n-sum(takes.values())
    for g in sorted(groups,key=lambda g:(-(quotas[g]%1),g))[:left]:takes[g]+=1
    chosen=set()
    for g,xs in groups.items():
        ranked=sorted(xs,key=lambda x:hashlib.sha256((f['seed']+':'+x['id']).encode()).hexdigest())
        chosen.update(x['id'] for x in ranked[:takes[g]])
    return [x['id'] for x in items if x['id'] in chosen]
checks['seeded_cohort']=sample(72)==s['selectedIds']
checks['seeded_pilot']=sample(20)==f['pilotIds']
checks['pilot_retained']=set(f['pilotIds'])<=set(s['selectedIds'])
checks['size_from_time_and_cost_only']=s['size']==20+math.floor(s['remainingSeconds']/(s['secondsPerItem']*1.35))
parts=[load('test-pilot'),load('test-remainder')]
ds=t['contestants'][0]['decisions']
checks['one_decision_per_selected_item']=len(ds)==72 and len({d['id'] for d in ds})==72 and {d['id'] for d in ds}==set(s['selectedIds'])
checks['disjoint_stages']=not(set(d['id'] for d in parts[0]['contestants'][0]['decisions'])&set(d['id'] for d in parts[1]['contestants'][0]['decisions']))
checks['official_labels_unchanged']=all(d['correct']==byid[d['id']]['correct'] for d in ds)
checks['not_stopped']=not t.get('stopped')
corrections={x['id']:x['audited_correct'] for x in items if x['verdict']=='proved_conflict'}
strict={x['id']:x['audited_correct'] for x in items if x['verdict']=='proved_conflict' and x['proof_class']=='literal_premises'}
assert len(corrections)==23 and len(strict)==22
near=lambda x,y:abs(x-y)<1e-10
def wilson(k,n,z):
    p=k/n;d=1+z*z/n;c=(p+z*z/(2*n))/d;h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return {'estimate':p,'lower':max(0,c-h),'upper':min(1,c+h)}
for name,labels in [('official',{}),('audited',corrections),('strictAudited',strict)]:
    right=lambda d:isinstance(d.get('pass'),bool) and d['pass']==labels.get(d['id'],byid[d['id']]['correct'])
    k=sum(right(d) for d in ds)
    checks[name+'_counts']=m[name]['right']==k and m[name]['n']==72 and near(m[name]['sampleAccuracy'],k/72)
    w=wilson(k,72,1.959963984540054)
    checks[name+'_sample_interval']=all(near(w[key],m[name]['sampleWilson95'][key]) for key in w)
    weighted={key:0 for key in w}
    for g,xs in groups.items():
        rows=[d for d in ds if stratum(byid[d['id']])==g];count=sum(right(d) for d in rows)
        interval=wilson(count,len(rows),2.497705474412374) if len(rows)!=len(xs) else dict.fromkeys(w,count/len(rows))
        for key in w:weighted[key]+=len(xs)/221*interval[key]
    checks[name+'_stratified_interval']=all(near(weighted[key],m[name]['populationWeighted'][key]) for key in w)
cost=sum(x['contestants'][0]['costUsd'] for x in parts)
checks['cost_arithmetic']=near(cost,t['contestants'][0]['costUsd']) and near(cost*100/72,m['costPer100Usd'])
checks['new_spend_arithmetic']=near(sum(x['newSpendUsd'] for x in parts),m['newSpendUsd'])
checks['new_calls_arithmetic']=sum(x['newCalls'] for x in parts)==t['newCalls']
record='examples/judge-benchmarks/recordings/longjudge-verify/haiku.jsonl'
baseline=len(subprocess.check_output(['git','show','0fa48a41:'+record],cwd=R,text=True).splitlines())
rows=[json.loads(line) for line in (R/record).read_text().splitlines()]
start=load('test-started')
checks['task_recorded_spend_at_72']=near(start['before']+m['newSpendUsd'],m['taskRecordedSpendUsd'])
checks['recorded_spend_below_cap']=m['taskRecordedSpendUsd']<7.97
out={'at':datetime.now(timezone.utc).isoformat(),'freeze':f['sha'],'checks':checks,'allPassed':all(checks.values()),'binaryVerdicts':sum(isinstance(d.get('pass'),bool) for d in ds),'missing':sum(d['missing'] for d in ds),'resultLastWriteUTC':datetime.fromtimestamp((P/'test-metrics.json').stat().st_mtime,timezone.utc).isoformat(),'source_or_label_changes':0,'model_calls':0}
(P/'final-evidence-checks.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
assert out['allPassed']
