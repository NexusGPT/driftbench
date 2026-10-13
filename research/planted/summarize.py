"""Produce metrics only from saved judgments; no calls and no label fitting."""
from pathlib import Path
from collections import Counter, defaultdict
from itertools import combinations
import hashlib,json,math,os,random,statistics,subprocess

root=Path(__file__).parent
runtime=root/os.environ.get('ASTRA_EVIDENCE_DIR','runtime' if (root/'runtime').exists() else 'results')
Z=1.959963984540054
def load(name):return json.loads((root/name).read_text())
def read_rows(name):
    p=runtime/name
    if not p.exists():return []
    return json.loads(p.read_text())
def wilson(k,n):
    if not n:return None
    p=k/n;d=1+Z*Z/n;center=(p+Z*Z/(2*n))/d
    radius=Z*math.sqrt(p*(1-p)/n+Z*Z/(4*n*n))/d
    return {'success':k,'n':n,'estimate':p,'lower':center-radius,'upper':center+radius}
def pct(x):return f'{100*x:.2f}%'
def rate(x):return f"{x['success']}/{x['n']} = {pct(x['estimate'])} ({pct(x['lower'])} to {pct(x['upper'])})"
def bootstrap_mean(values,seed):
    rng=random.Random(seed);n=len(values)
    means=sorted(sum(rng.choices(values,k=n))/n for _ in range(10000))
    return [means[249],means[9749]]
def calls(tag):
    paths=list((runtime/'recordings'/tag).glob('**/haiku.jsonl'))
    rows=[]
    for p in paths:rows += [json.loads(s) for s in p.read_text().splitlines() if s]
    return {'successfulRecordedCalls':len(rows),'usd':sum(x['costUsd'] for x in rows),
            'stages':dict(Counter(x.get('order') for x in rows)),
            'callsByItem':dict(Counter(x.get('item') for x in rows))}
manifest=load('manifest.json');vb=load('bank-verify.json');rb=load('bank-rb.json')
cohorts=load('noise-cohorts.json');start=json.loads((runtime/'run-start.json').read_text())
meter=json.loads((runtime/'meter-state.json').read_text())
vr=read_rows('bank-verify.json');rr=read_rows('bank-rb.json')
vindex={x['id']:x for x in vr};rindex={x['id']:x for x in rr}
metrics={'freezeCommit':start['freezeCommit'],'generatedAt':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
         'bank':{},'noise':{},'meter':meter,'construction':manifest}
for bench,bank,index in [('verify',vb,vindex),('rb',rb,rindex)]:
    tpr=tnr=joint=0;complete=0;evaluated=0;families=defaultdict(lambda:dict(n=0,tp=0,tn=0,joint=0))
    itemrows=[]
    for item in bank:
        if bench=='verify':
            a=index.get(item['id']+'-clean',{});b=index.get(item['id']+'-defect',{})
            evaluated+=bool(a) and bool(b)
            cp=a.get('pass') is True;dc=b.get('pass') is False
            valid=isinstance(a.get('pass'),bool) and isinstance(b.get('pass'),bool)
        else:
            row=index.get(item['id'],{});cp=row.get('cleanPass') is True;dc=row.get('defectCaught') is True
            evaluated+=bool(row)
            valid=isinstance(row.get('cleanPass'),bool) and isinstance(row.get('defectCaught'),bool)
        tpr+=dc;tnr+=cp;joint+=cp and dc;complete+=valid
        f=families[item['family']];f['n']+=1;f['tp']+=dc;f['tn']+=cp;f['joint']+=cp and dc
        itemrows.append({'id':item['id'],'family':item['family'],'complete':valid,'cleanPassed':cp,'defectCaught':dc})
    cost=calls('bank-'+bench)
    metrics['bank'][bench]={'pairs':len(bank),'complete':evaluated,'validRequirementGrades':complete,'invalidOrMissingGrades':len(bank)-complete,'TPR':wilson(tpr,len(bank)),
                            'TNR':wilson(tnr,len(bank)),'bothTwinsCorrect':wilson(joint,len(bank)),
                            'familyCounts':dict(families),'items':itemrows,**cost}
    judgmentIds=[x['id']+suffix for x in bank for suffix in ['-clean','-defect']] if bench=='verify' else [x['id'] for x in bank]
    counts=[cost['callsByItem'].get(id,0) for id in judgmentIds]
    metrics['bank'][bench]['newCallsPerJudgment']={'mean':sum(counts)/len(counts),'min':min(counts),'max':max(counts),'counts':counts}
    seen=set();unique=[]
    for item,row in zip(bank,itemrows):
        key=(item['question'],item['clean'],item['defect'])
        if key not in seen:unique.append(row);seen.add(key)
    metrics['bank'][bench]['uniqueStimuli']=len(unique)
    metrics['bank'][bench]['deduplicatedTPR']=wilson(sum(x['defectCaught'] for x in unique),len(unique))
    metrics['bank'][bench]['deduplicatedTNR']=wilson(sum(x['cleanPassed'] for x in unique),len(unique))
    if bench=='rb':
        metrics['bank'][bench]['cleanWinner']=wilson(sum(rindex.get(x['id'],{}).get('decision')=='A' for x in bank),len(bank))
        metrics['bank'][bench]['conditionalTPRValidOnly']=wilson(tpr,complete)
        metrics['bank'][bench]['conditionalTNRValidOnly']=wilson(tnr,complete)
    if bench=='verify':
        batches=[json.loads(s) for s in (runtime/'bank-verify-batches.jsonl').read_text().splitlines()] if (runtime/'bank-verify-batches.jsonl').exists() else []
        metrics['bank'][bench]['promptRequestsIncludingReplay']=sum(b['contestants'][0]['calls'] for b in batches)
        metrics['bank'][bench]['replayHits']=sum(b['replayed'] for b in batches)
for bench,N in [('verify',95),('rb',357)]:
    reps=[read_rows(f'noise-{bench}-{i}.json') for i in [1,2,3]]
    maps=[{x['id']:x for x in xs} for xs in reps]
    ids=[x['id'] for x in cohorts[bench]]
    rows=[]
    for id in ids:
        source=next(x for x in cohorts[bench] if x['id']==id)
        ds=[x.get(id,{}).get('pass' if bench=='verify' else 'decision') for x in maps]
        valid=all(isinstance(x,bool) for x in ds) if bench=='verify' else all(x in ['A','B','tie'] for x in ds)
        if not valid:continue
        ys=[d==source['correct'] for d in ds] if bench=='verify' else [d==source['label'] for d in ds]
        flips=sum(a!=b for a,b in combinations(ds,2));cflips=sum(a!=b for a,b in combinations(ys,2))
        rows.append({'id':id,'decisions':ds,'correctness':ys,'pairwiseFlips':flips,'correctnessFlips':cflips,'anyFlip':len(set(ds))>1})
    costs=[calls(f'noise-{bench}-{i}') for i in [1,2,3]]
    block={'requestedItems':30,'completeItems':len(rows),'repeatCounts':[len(x) for x in reps],
           'costs':costs,'successfulRecordedCalls':sum(x['successfulRecordedCalls'] for x in costs),
           'usd':sum(x['usd'] for x in costs),'items':rows}
    counts=[c['callsByItem'].get(id,0) for c in costs for id in ids]
    block['newCallsPerPlannedJudgment']={'mean':sum(counts)/90,'min':min(counts),'max':max(counts),'counts':counts}
    if rows:
        n=len(rows);flip=sum(x['pairwiseFlips'] for x in rows)/(3*n);cflip=sum(x['correctnessFlips'] for x in rows)/(3*n)
        vari=cflip/2
        floor=Z*math.sqrt(2*vari/N);cohortFloor=Z*math.sqrt(2*vari/n)
        iteminterval=wilson(sum(x['anyFlip'] for x in rows),n)
        accuracyUnstable=wilson(sum(x['correctnessFlips']>0 for x in rows),n)
        conservativeFloor=Z*math.sqrt((2/3)*accuracyUnstable['upper']/N)
        boot=bootstrap_mean([x['correctnessFlips']/3 for x in rows],manifest['seed']+bench)
        discrete=math.floor(floor*N+1e-10)+1
        # repeatsForFloor: pass variance is disagreement/2; the API's flipRate input has a different meaning.
        repeats=max(1,math.ceil(2*Z*Z*vari/(N*.01**2)))
        block.update({'pairwiseFlipRate':flip,'correctnessFlipRate':cflip,'flips':sum(x['pairwiseFlips'] for x in rows),'pairComparisons':3*n,
                      'anyFlipItems':iteminterval,'accuracyByRepeat':[sum(x['correctness'][k] for x in rows)/n for k in range(3)],
                      'meanUnbiasedWithinItemVariance':vari,'floor95FullDevExtrapolated':floor,'floor95ThirtyItemCohort':cohortFloor,
                      'fullDevN':N,'smallestStrictlyLargerDevGainItems':discrete,'smallestStrictlyLargerDevGain':discrete/N,
                      'accuracyUnstableItems':accuracyUnstable,'pilotUpperBoundFloor':conservativeFloor,
                      'smallestLargerGainAbovePilotUpperBoundItems':math.floor(conservativeFloor*N+1e-10)+1,
                      'correctnessFlipBootstrap95':boot,'floorBootstrap95':[Z*math.sqrt(x/N) for x in boot],
                      'repeatsForOnePercentagePointFloor':repeats,
                      'zeroFlipCaution':flip==0,
                      'noFlipRiskBound':{'method':'Wilson upper bound on chance an item flips across three repeats','upper':iteminterval['upper']}})
    metrics['noise'][bench]=block
spendrows=[json.loads(x) for x in (runtime/'spend.jsonl').read_text().splitlines()]
metrics['runControls']={'initial':start,'resumes':[json.loads(x) for x in (runtime/'resumes.jsonl').read_text().splitlines()] if (runtime/'resumes.jsonl').exists() else [],'finalCapUsd':16,'maxConcurrentCalls':6,'lastNewCall':'2026-10-13T06:35:00+02:00'}
metrics['models']=sorted({m for x in spendrows for m in x.get('models',[])})
metrics['meterAudit']={'attempts':len(spendrows),'sumKnownCosts':sum(x['costUsd'] or 0 for x in spendrows),'unpricedAttempts':sum(x['costUsd'] is None for x in spendrows),
                       'errors':sum(x['isError'] is True or x['exitCode']!=0 for x in spendrows)}
metrics['meterAudit']['successfulRecordedCalls']=sum(x['successfulRecordedCalls'] for x in metrics['bank'].values())+sum(x['successfulRecordedCalls'] for x in metrics['noise'].values())
metrics['meterAudit']['unrecordedTransportAttempts']=meter['calls']-metrics['meterAudit']['successfulRecordedCalls']
lines=['# Planted truth and noise floor','',f"Measured {metrics['generatedAt']}. Branch `research/astra-planted-truth`.",
       f"Bank freeze commit: `{start['freezeCommit']}`. Seed: `{manifest['seed']}`.",'',
       '| Benchmark | Evaluated pairs | Strict defect detection, TPR (95% Wilson) | Strict clean acceptance, TNR (95% Wilson) | Both twins correct |',
       '|---|---:|---|---|---|']
for bench in ['verify','rb']:
    b=metrics['bank'][bench]
    lines.append(f"| {bench} | {b['complete']}/{b['pairs']} | {rate(b['TPR'])} | {rate(b['TNR'])} | {rate(b['bothTwinsCorrect'])} |")
lines+=['','These are construction-truth measurements. Each bank uses 10 repeated DEV templates. They are not original-benchmark accuracy estimates.',
        f"The frozen verify bank contains {metrics['bank']['verify']['uniqueStimuli']} distinct pairs among 95 rows. Four exact repeats arise from the probability-template parameter cycle. The bank stays frozen; these rows are not silently replaced after judging.",
        f"Deduplicated verify TPR: {rate(metrics['bank']['verify']['deduplicatedTPR'])}. Deduplicated TNR: {rate(metrics['bank']['verify']['deduplicatedTNR'])}. RubricBench contains 60 distinct pairs.",
        'Verify has 190 answer judgments from 95 pairs. RubricBench has 60 canonical pair judgments, each evaluating one verbatim objective expert requirement.',
        'Rubric TPR uses a score below full satisfaction on the defective reply. TNR uses full satisfaction on the clean reply. These are correlated within each pair.',
        f"RubricBench returns exactly one valid requirement grade on {metrics['bank']['rb']['validRequirementGrades']}/60 pairs. On {metrics['bank']['rb']['invalidOrMissingGrades']}/60, the single-requirement schema is not met. Those outcomes count as unsuccessful in both strict rates, as specified before calls. They are protocol failures, not observed wrong semantic classifications.",
        'Wilson intervals treat generated instances as independent Bernoulli observations. Reused template families limit that assumption and generalization.',
        '',f"RubricBench clean-winner recovery: {rate(metrics['bank']['rb']['cleanWinner'])}.",
        f"Conditional on a valid single-requirement output, RubricBench TPR is {rate(metrics['bank']['rb']['conditionalTPRValidOnly'])} and TNR is {rate(metrics['bank']['rb']['conditionalTNRValidOnly'])}. This conditional view excludes schema failures and does not replace the strict headline.",'',
        '| Noise cohort | Complete items x repeats | Verdict flips / comparisons | Items with any flip | 95% floor on 30 items | Extrapolated full-DEV floor | Smallest larger full-DEV gain |',
        '|---|---:|---:|---:|---:|---:|---:|']
for bench in ['verify','rb']:
    b=metrics['noise'][bench]
    if 'pairwiseFlipRate' not in b:
        lines.append(f"| {bench} | {b['completeItems']} x 3 | pending | pending | pending | pending | pending |")
    else:
        lines.append(f"| {bench} | {b['completeItems']} x 3 | {b['flips']}/{b['pairComparisons']} ({pct(b['pairwiseFlipRate'])}) | {b['anyFlipItems']['success']}/{b['completeItems']} | {pct(b['floor95ThirtyItemCohort'])} | {pct(b['floor95FullDevExtrapolated'])} | {b['smallestStrictlyLargerDevGainItems']}/{b['fullDevN']} ({pct(b['smallestStrictlyLargerDevGain'])}) |")
lines+=['','The noise cohorts are restricted DEV samples: 30 of 38 eligible verify math/fictional-logic items, and all 30 eligible RubricBench math/MBPP items.',
        'They do not represent all domains. Full-DEV thresholds extrapolate their estimated within-item variance to N=95 and N=357 respectively.',
        'All three pair comparisons per item are reported. They are correlated, so the uncertainty calculation resamples items with their repeats together.',
        'Each repetition uses a fresh model-recording namespace. Prompts stay identical. Deterministic code evidence may be reused; model replies are not reused between repeats.',
        'The floor is 1.95996 times sqrt(correctness-disagreement / N), for the difference between two independent one-run DEV accuracies. It is a pilot estimate, not a significance guarantee.',
        'The smallest larger gain rounds this floor upward to the next achievable item count. A real variant comparison still needs a paired test and its own error control.','']
lines+=['','| Bank | DEV template | Constructed task | Pairs |','|---|---|---|---:|']
familyNames={'verify':['Bracket closure','Expected marble sum','Prime factorization','Distinct tens digits','Successive discounts','Exponents and products','Parabola locus','Diagonal inverse','Unspecified fictional color','Linear equations'],
             'rb':['Frequency dictionary','Adjacent tuple pairs','Element cubes','Nested integer sum','All capitals','No capitals','No commas','Exactly four numbers','Second paragraph prefix','Complete code fence']}
for bench,bank in [('verify',vb),('rb',rb)]:
    for family in range(10):
        group=[x for x in bank if x['family']==family]
        lines.append(f"| {bench} | `{group[0]['source']['id']}` | {familyNames[bench][family]} | {len(group)} |")
lines+=['','These counts expose template reuse. The approved construction changes parameters and one answer component; it does not create 155 independent task families.','']
for bench in ['verify','rb']:
    b=metrics['noise'][bench]
    if 'pairwiseFlipRate' in b:
        lines.append(f"- {bench}: accuracy by repeat {', '.join(pct(x) for x in b['accuracyByRepeat'])}; correctness flips {pct(b['correctnessFlipRate'])}; repeats per item for a 1-point full-DEV floor: {b['repeatsForOnePercentagePointFloor']}.")
        lines.append(f"- {bench}: item-bootstrap 95% interval for the full-DEV floor: {pct(b['floorBootstrap95'][0])} to {pct(b['floorBootstrap95'][1])}.")
        lines.append(f"- {bench}: using the Wilson upper bound on three-repeat accuracy instability gives a conservative pilot guardrail of {pct(b['pilotUpperBoundFloor'])}; exceeding it requires {b['smallestLargerGainAbovePilotUpperBoundItems']}/{b['fullDevN']} items. This is an uncertainty sensitivity calculation, not a separate measured improvement.")
        if b['zeroFlipCaution']:lines.append(f"- {bench}: zero observed flips does not prove determinism. The Wilson upper bound on the chance an item flips within three repeats is {pct(b['noFlipRiskBound']['upper'])}.")
lines+=['','| Experiment | Actual new model calls | Model prompt requests | Recorded USD |', '|---|---:|---:|---:|']
for bench in ['rb','verify']:
    b=metrics['bank'][bench]
    lines.append(f"| {bench} bank | {b['successfulRecordedCalls']} | {b.get('promptRequestsIncludingReplay',b['successfulRecordedCalls'])} | {b['usd']:.7f} |")
for bench in ['rb','verify']:
    b=metrics['noise'][bench]
    lines.append(f"| {bench} noise | {b['successfulRecordedCalls']} | {b['successfulRecordedCalls']} | {b['usd']:.7f} |")
lines+=['',f"Total transport attempts: {meter['calls']}. Recorded spend: USD {meter['spent']:.7f}. Unpriced reserved amount: USD {meter['unknownReserved']:.2f}. Cap: USD 16.00. Peak active model calls: {meter['peak']}.",
        f"Observed model identifiers: {', '.join(metrics['models']) or 'not returned'}. Calls request the haiku alias.",'',
        f"The transport completed {metrics['meterAudit']['unrecordedTransportAttempts']} attempts without a retained judge recording. This includes calls finishing during transport scheduling restarts. Their spend remains included above.",
        'The initial bank run used two concurrent calls. The owner then raised concurrency to six and the task cap to USD 16. Existing bank predictions were preserved.',
        'Verify noise repeats run in parallel with two call slots each under the shared six-call ceiling. The scheduling restart preserves recorded replies within their own repetition and keeps repetitions separate.',
        'Per-judgment call accounting:',
        f"- Verify bank: {metrics['bank']['verify']['successfulRecordedCalls']} calls across 190 planned answer judgments, mean {metrics['bank']['verify']['newCallsPerJudgment']['mean']:.3f}; shared blind-reference cache hits are listed separately in metrics.json.",
        f"- RubricBench bank: {metrics['bank']['rb']['successfulRecordedCalls']} calls across 60 pairs, mean {metrics['bank']['rb']['newCallsPerJudgment']['mean']:.3f} per pair. One canonical comparison provides both requirement grades.",
        f"- Verify noise: {metrics['noise']['verify']['successfulRecordedCalls']} calls across 90 planned full-cascade judgments, mean {metrics['noise']['verify']['newCallsPerPlannedJudgment']['mean']:.3f}.",
        f"- RubricBench noise: {metrics['noise']['rb']['successfulRecordedCalls']} calls across 90 planned pair judgments, mean {metrics['noise']['rb']['newCallsPerPlannedJudgment']['mean']:.3f}.",'',
        'Verification and limits:',
        '- Independent read-back oracle checks accept all clean copies and reject all planted copies. Python function fixtures include empty inputs, negative values and repeated values.',
        '- No model assigns bank truth. Original benchmark labels are used only to display repeat accuracy, not to construct or select bank labels.',
        '- Source membership is checked with the frozen DEV hash rule. No TEST items are analyzed, judged or changed.',
        '- Frozen prompt and inference files are copied byte-for-byte. Runtime changes concern transport metering and result reporting only.',
        '- Partial, invalid or missing judgments cannot count as successes. Provider billing is authoritative; recorded CLI costs are not an invoice.',
        '', 'Evidence:',
        '- `research/planted/manifest.json`, `bank-verify.json`, `bank-rb.json`, `noise-cohorts.json`: committed pre-call stimuli and seed.',
        '- `research/planted/frozen-sources.json`: frozen judge source hashes.',
        '- `research/planted/audit-bank.py`: independent construction checks.',
        '- `research/planted/results/`: archived model recordings, per-item judgments, program observations, spend meter and progress.',
        '- `research/planted/metrics.json`: exact counts, intervals, family rows, noise triples and call-stage counts.','']
if any(b['complete']!=b['pairs'] for b in metrics['bank'].values()) or any(b['completeItems']!=30 for b in metrics['noise'].values()):
    lines.insert(2,'Status: INCOMPLETE. Pending cells are not completion claims.\n')
else:lines.insert(2,'Status: both banks and both 30-item, three-repeat pilots are measured.\n')
(root/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
report='\n'.join(lines)
assert not any(c in report for c in ['\u2013','\u2014'])
(root/'RESULTS.md').write_text(report)
if os.environ.get('ASTRA_REPORT'):
    Path(os.environ['ASTRA_REPORT']).write_text(report)
print(json.dumps({'bank':{k:{x:v[x] for x in ['complete','pairs','TPR','TNR']} for k,v in metrics['bank'].items()},'noise':{k:{x:v.get(x) for x in ['completeItems','pairwiseFlipRate','floor95FullDevExtrapolated']} for k,v in metrics['noise'].items()},'meter':meter},indent=2))
