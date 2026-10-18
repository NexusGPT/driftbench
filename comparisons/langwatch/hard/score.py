"""Free scoring of hard and frozen held-out cohorts; no model calls."""
import json,math,pathlib,hashlib
HERE=pathlib.Path(__file__).parent
import subprocess,sys
subprocess.run([sys.executable,str(HERE/'restore-recordings.py')],check=True,stdout=subprocess.DEVNULL)

def wilson(k,n):
 if not n:return [None,None]
 z=1.959963984540054;p=k/n;den=1+z*z/n;center=(p+z*z/(2*n))/den;half=z*math.sqrt((p*(1-p)+z*z/(4*n))/n)/den
 return [max(0,center-half),min(1,center+half)]
def result(cases,answers,predict,truth):
 by_id={a['id']:a for a in answers};correct=[];wrong=[];unanswered=0;unscored=[]
 for c in cases:
  a=by_id.get(c['id']);p=predict(a) if a is not None and not a.get('unscored') else None
  if a is not None and a.get('unscored'):
   unscored.append(c['id']);continue
  if p is None:unanswered+=1
  (correct if p is not None and p==truth(c) else wrong).append(c['id'])
 n=len(cases)-len(unscored)
 return {'correct':len(correct),'n':n,'total':len(cases),'ci95':wilson(len(correct),n),'unanswered':unanswered,'unscored':len(unscored),'correct_ids':correct,'wrong_ids':wrong,'unscored_ids':unscored}
def fold(values):
 if not isinstance(values,list) or any(v not in ['pass','fail','inconclusive'] for v in values):return None
 return 'fail' if 'fail' in values else 'inconclusive' if 'inconclusive' in values else 'pass'
def metric(cases,d,predict,truth):
 complete=d.get('complete',len(d['answers'])==len(cases));answers=d['answers'];seen={a['id'] for a in answers}
 pending=[] if complete else [c['id'] for c in cases if c['id'] not in seen]
 # Unsubmitted cases affect coverage only. Completed missing answers still fail.
 scored=answers+[{'id':id,'unscored':True} for id in pending]
 r=result(cases,scored,predict,truth);r.update(complete=complete,pending=len(pending),pending_ids=pending,transportUnscored=r['unscored']-len(pending),attributableUsd=sum(a.get('costUsd',0) for a in answers),transportRecovered=sum(a.get('transportRecovered',False) for a in answers));return r
def score():
 rows={};paths=[]
 for cohort in ['hard','heldout']:
  tag='' if cohort=='hard' else '-heldout'
  for kind in ['judges','simulator','pii','injection','pairwise']:
   casepath=({'judges':f'judges-{cohort}-v4.json' if cohort=='heldout' else 'judges-v4.json','simulator':f'simulator{tag}.json','pii':f'pii/{"hard" if cohort=="hard" else "heldout"}.json','injection':f'injection/{"hard" if cohort=="hard" else "heldout"}.json','pairwise':'../pairwise/hard.json' if cohort=='hard' else 'pairwise-heldout.json'})[kind]
   cases=json.loads((HERE/casepath).read_text());paths.append(casepath)
   variants={'judges':['ours','audit','theirs'],'simulator':['ours','checked','theirs'],'pii':['ours','audit'],'injection':['ours','audit'],'pairwise':['ours','checked','theirs']}[kind]
   for variant in variants:
    key=f'{kind}-{variant}{tag}';file=HERE/'recorded'/f'{key}.json'
    if kind=='pairwise' and cohort=='hard':
     legacy={'ours':'ours-haiku-hard.json','checked':'ours-audit-checked-haiku-hard.json','theirs':'theirs-haiku-hard.json'}[variant];file=HERE/'../pairwise/recorded'/legacy
    if not file.exists():continue
    d=json.loads(file.read_text())
    if kind=='judges':
     rows[key+'-primary']=metric(cases,d,lambda a:(a.get('predictions') or [None])[0],lambda c:c['truth'][0])
     rows[key+'-vector']=metric(cases,d,lambda a:a.get('predictions') if len(a.get('predictions',[]))==len(cases[0]['criteria']) and all(p is not None for p in a['predictions']) else None,lambda c:c['truth'])
     rows[key+'-aggregate']=metric(cases,d,lambda a:fold(a.get('predictions')),lambda c:fold(c['truth']))
    elif kind=='simulator':rows[key]=metric(cases,d,lambda a:None if a.get('error') else a.get('correct'),lambda c:True)
    elif kind=='pairwise':rows[key]=metric(cases,d,lambda a:a.get('choice'),lambda c:'first' if c['better']=='A' else 'second')
    else:
     rows[key]=metric(cases,d,lambda a:a.get('prediction'),lambda c:c['truth'])
     if kind=='pii':
      rows[key+'-enabled']=metric([c for c in cases if not c['truth'] or c['identifier']],d,lambda a:a.get('prediction'),lambda c:c['truth'])
      rows[key+'-judge-scope']=metric(cases,d,lambda a:a.get('judgePrediction'),lambda c:c['person'] or c['address'])
      if variant=='ours':rows[key+'-judge-only-full']=metric(cases,d,lambda a:a.get('judgePrediction'),lambda c:c['truth'])
   if kind=='pii':
    d=json.loads((HERE/'pii'/('native-results.json' if cohort=='hard' else 'native-heldout-results.json')).read_text());d={'answers':d['results'],'complete':True}
    rows[f'pii-native{tag}']=metric(cases,d,lambda a:a.get('prediction'),lambda c:c['truth'])
    rows[f'pii-native{tag}-enabled']=metric([c for c in cases if not c['truth'] or c['identifier']],d,lambda a:a.get('prediction'),lambda c:c['truth'])
 for cohort,fixture in [('', '../pairwise/hard.json'),('-heldout','pairwise-heldout.json')]:
  path=HERE/'recorded'/f'pairwise-pr115{cohort}.json'
  if path.exists():
   cases=json.loads((HERE/fixture).read_text());rows[f'pairwise-pr115{cohort}']=metric(cases,json.loads(path.read_text()),lambda a:a.get('choice'),lambda c:'first' if c['better']=='A' else 'second')
 for variant,tag,fixture in [('pr115','','judges-v4.json'),('pr115','-heldout','judges-heldout-v4.json'),('compliance','','judges-v4.json'),('compliance','-heldout-v2','judges-heldout-v2.json'),('ours','-heldout-v2','judges-heldout-v2.json'),('theirs','-heldout-v2','judges-heldout-v2.json')]:
  key=f'judges-{variant}{tag}';path=HERE/'recorded'/f'{key}.json'
  if not path.exists():continue
  cases=json.loads((HERE/fixture).read_text());paths.append(fixture);d=json.loads(path.read_text())
  rows[key+'-primary']=metric(cases,d,lambda a:(a.get('predictions') or [None])[0],lambda c:c['truth'][0])
  rows[key+'-vector']=metric(cases,d,lambda a:a.get('predictions') if len(a.get('predictions',[]))==2 and all(p is not None for p in a['predictions']) else None,lambda c:c['truth'])
 newcases_path=HERE/'injection/heldout-v2.json'
 if newcases_path.exists():
  fresh=json.loads(newcases_path.read_text());paths.append('injection/heldout-v2.json')
  hard=json.loads((HERE/'injection/hard.json').read_text())
  for variant,cohort,cases in [('attempt','',hard),('attempt','-heldout-v2',fresh),('ours','-heldout-v2',fresh)]:
   key='injection-'+variant+cohort;path=HERE/'recorded'/f'{key}.json'
   if path.exists():rows[key]=metric(cases,json.loads(path.read_text()),lambda a:a.get('prediction'),lambda c:c['truth'])
 for prefix,fixture in [('longtrace','longtrace/hard.json'),('adapter-v2','judges-entries-v2.json'),('longtrace-v2','longtrace-v2/hard.json')]:
  longcases_path=HERE/fixture
  if not longcases_path.exists():continue
  cases=json.loads(longcases_path.read_text());paths.append(fixture)
  for variant in ['ours','audit','theirs','compliance','pr115']:
   path=HERE/'recorded'/f'{prefix}-{variant}.json'
   if not path.exists():continue
   d=json.loads(path.read_text());key=f'{prefix}-{variant}'
   rows[key+'-primary']=metric(cases,d,lambda a:(a.get('predictions') or [None])[0],lambda c:c['truth'][0])
   rows[key+'-receipt']=metric(cases,d,lambda a:(a.get('predictions') or [None,None])[1],lambda c:c['truth'][1])
   rows[key+'-vector']=metric(cases,d,lambda a:a.get('predictions') if len(a.get('predictions',[]))==2 and all(p is not None for p in a['predictions']) else None,lambda c:c['truth'])
   flatcases=[{'id':c['id']+'::'+str(i),'truth':truth} for c in cases for i,truth in enumerate(c['truth'])]
   flatanswers=[{'id':a['id']+'::'+str(i),'prediction':p,'unscored':a.get('unscored',False),'costUsd':a['costUsd'] if i==0 else 0} for a in d['answers'] for i,p in enumerate(a['predictions'])]
   flat={'answers':flatanswers,'complete':d['complete']};rows[key+'-criteria']=metric(flatcases,flat,lambda a:a['prediction'],lambda c:c['truth'])
   byid={a['id']:a for a in d['answers']};matrix={t:{p:0 for p in ['pass','fail','inconclusive','invalid','unscored']} for t in ['pass','fail','inconclusive']}
   for c in cases:
    a=byid.get(c['id']);p='unscored' if a and a.get('unscored') else (a.get('predictions') or [None])[0] if a else None
    matrix[c['truth'][0]][p if p in matrix[c['truth'][0]] else 'invalid']+=1
   rows[key+'-primary']['confusionMatrix']=matrix
   rows[key+'-primary']['familyScores']={kind:result([c for c in cases if c['kind']==kind],d['answers'],lambda a:(a.get('predictions') or [None])[0],lambda c:c['truth'][0]) for kind in sorted({c['kind'] for c in cases})}
 calls=[json.loads(l) for l in (HERE/'recorded/calls.jsonl').read_text().splitlines()]
 return {'rows':rows,'recordedInvocations':sum(not c.get('reservationOnly') for c in calls),'chargedRecords':len(calls),'uniqueSpendUsd':sum(c['costUsd'] for c in calls),'transportFailures':sum(c['failed'] and not c.get('reservationOnly') for c in calls),'interruptedReservations':sum(c.get('reservationOnly',False) for c in calls),'reservationUsd':sum(c['costUsd'] for c in calls if c.get('reservationOnly')),'fixtures':{p:hashlib.sha256((HERE/p).read_bytes()).hexdigest() for p in sorted(set(paths))}}
def cell(r):
 if r is None:return 'pending'
 lo,hi=r['ci95'];ci='unscored' if lo is None else f'{100*lo:.2f}% to {100*hi:.2f}%'
 return f"{r['correct']}/{r['n']} (95% {ci}; coverage {r['n']}/{r['total']}; {r['unanswered']} unanswered)"+(' [partial]' if not r['complete'] else '')
def render(data):
 rows=data['rows'];lines=['# Hard and fresh held-out results','', 'Candidates are **not yet the shipped default**. Fresh cohort seed: 20261013.','', '| Row | Hard shipped | Hard candidate | Hard native default | Fresh shipped | Fresh candidate | Fresh native default |','|---|---|---|---|---|---|---|']
 entries=[('Per-criterion rules','judges','audit','-primary'),('Verdict vector','judges','audit','-vector'),('Simulated user','simulator','checked',''),('PII full','pii','audit',''),('PII enabled scope','pii','audit','-enabled'),('Injection','injection','audit',''),('Pairwise','pairwise','checked','')]
 for name,kind,candidate,metric_name in entries:
  cells=[]
  for tag in ['', '-heldout']:
   for variant in ['ours',candidate,'native' if kind=='pii' else 'theirs']:
    cells.append('unmeasured (Azure)' if kind=='injection' and variant=='theirs' else cell(rows.get(f'{kind}-{variant}{tag}{metric_name}')))
  lines.append('| '+name+' | '+' | '.join(cells)+' |')
 if any(k.startswith('pairwise-pr115') for k in rows):
  lines += ['', '## PR 115 default at approved commit', '', 'The old main contract remains the historical baseline above. PR 115 default is measured from a fresh detached checkout at 8195902dd20c84267f85feba268c17868e00dfbe; replacement depends on CI/merge.', '', '| Cohort | PR 115 default | Audit candidate, not yet shipped | Native default |', '|---|---|---|---|']
  for tag,name in [('', 'Hard 120'),('-heldout','Frozen fresh 60')]:lines.append('| '+name+' | '+' | '.join(cell(rows.get('pairwise-'+v+tag)) for v in ['pr115','checked','theirs'])+' |')
 if any(k.startswith('judges-compliance') for k in rows):
  lines += ['', '## Conformance candidate, not yet the shipped default', '', '| Metric/cohort | Old shipped criterion judge | Conformance candidate | Native default |', '|---|---|---|---|']
  for tag,name in [('', 'Hard 120'),('-heldout-v2','New fresh 60 seed 20261018')]:
   for suffix,label in [('-primary','primary'),('-vector','vector')]:lines.append('| '+name+' '+label+' | '+' | '.join(cell(rows.get('judges-'+v+tag+suffix)) for v in ['ours','compliance','theirs'])+' |')
 if 'injection-attempt' in rows or 'injection-attempt-heldout-v2' in rows:
  lines += ['', '## Attempt-aware injection repair', '', 'The original audit v1 loss remains in the table above. V2 is not yet the shipped default. It is designed from hard failures and scored once on hard plus a new 60-case, zero-overlap cohort at seed 20261017. Native Azure stays unmeasured on this new cohort.', '', '| Cohort | Shipped | Original audit v1 | Attempt-aware v2 | Native default |', '|---|---|---|---|---|', '| Hard | '+cell(rows.get('injection-ours'))+' | '+cell(rows.get('injection-audit'))+' | '+cell(rows.get('injection-attempt'))+' | unmeasured (Azure) |', '| New fresh seed 20261017 | '+cell(rows.get('injection-ours-heldout-v2'))+' | not rerun; original fresh remains above | '+cell(rows.get('injection-attempt-heldout-v2'))+' | unmeasured (Azure) |']
 if any(k.startswith('longtrace-') for k in rows):
  lines += ['', '## Preregistered long traces', '', 'Primary metric: correct individual criteria out of 240. Per-case primary, receipt and complete vector scores are secondary. The earlier ceiling result remains separate.', '', '| Metric | Shipped | Audit candidate | Native default | Conformance candidate | PR115 default |', '|---|---|---|---|---|---|']
  for suffix,name in [('-criteria','All criteria'),('-primary','Primary criterion'),('-receipt','Receipt criterion'),('-vector','Complete vector')]:lines.append('| '+name+' | '+' | '.join(cell(rows.get('longtrace-'+v+suffix)) for v in ['ours','audit','theirs','compliance','pr115'])+' |')
 lines+=['','| Measurement | Model USD per 100 scored units | Attributable USD | Unscored transport cases |','|---|---|---|---|']
 for key,r in rows.items():lines.append(f"| {key} | {100*r['attributableUsd']/r['n'] if r['n'] else 0:.8f} | {r['attributableUsd']:.8f} | {r.get('transportUnscored',r['unscored'])} |")
 lines+=['',f"New-task recorded invocations: {data['recordedInvocations']}; unique charged spend {data['uniqueSpendUsd']:.8f} USD, including {data['interruptedReservations']} interrupted-call reservations totaling {data['reservationUsd']:.2f} USD.",f"Raw failed CLI invocations: {data['transportFailures']}. Empty native structured CLI outputs receive one recovery attempt; unrecovered transport cases are unscored, never quality losses.",'','Prototype judge sets v1/v2/v3 are excluded from accuracy, but all their charges remain. Pairwise hard scores come from the preceding round; their attributable costs are shown but excluded from new-task spend.','', 'Hard sets are the development cohorts. Candidate procedures are frozen before generative held-out calls. Held-out labels and source/fixture hashes are recorded before calls. No held-out tuning occurs. Shared generator families remain correlated; Wilson intervals are descriptive and do not prove population-level superiority. Azure results stay unmeasured without native credentials; no proxy is used.']
 return '\n'.join(lines)+'\n'
if __name__=='__main__':
 data=score();(HERE/'recorded/summary.json').write_text(json.dumps(data,indent=2)+'\n');text=render(data);(HERE/'recorded/results.md').write_text(text);print(text)
