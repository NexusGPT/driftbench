"""Offline reporting for the two separately budgeted writing cells."""
import collections
import datetime
import hashlib
import json
from pathlib import Path
import sys
from stats import summarize

HERE=Path(__file__).resolve().parent
DOSSIER=Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/codex/dossier-ledger-wp.md')
MODELS=['claude-sonnet-5-5','gpt-6.1-sol']
def rows(path):
    return [json.loads(x) for x in path.read_text().splitlines() if x] if path.exists() else []
def write(path,obj):
    path.write_text(json.dumps(obj,indent=2)+'\n')
def spending(events):
    actual=0; pending={}
    for e in events:
        if e['kind']=='reserve': pending[e['key']]=e['usd']
        elif e['kind']=='settle': actual+=e['usd'];pending.pop(e['key'],None)
        elif e['kind']=='release':pending.pop(e['key'],None)
    return dict(actualUsd=actual,heldUsd=sum(pending.values()),pending=pending)
def main():
    reports=[]
    items=json.loads((HERE/'seals/test.json').read_text())
    old=rows(HERE/'results/decisions.jsonl')
    longer=summarize(items,[r for r in old if r['split']=='test' and r['contestant']=='longer-wins'])
    for model in MODELS:
        cell=HERE/'cells'/model
        if not (cell/'freeze.json').exists():continue
        freeze=json.loads((cell/'freeze.json').read_text())
        calls=rows(cell/'calls.jsonl'); decisions=rows(cell/'decisions.jsonl')
        if model=='gpt-6.1-sol':
            for r in calls:
                if not r['providerError']:
                    u=r['usage'];details=u.get('input_tokens_details',{});cached=details.get('cached_tokens',0);writes=details.get('cache_write_tokens',0)
                    r['costUsd']=((u['input_tokens']-cached-writes)*2+cached*.1+writes*2.5+u['output_tokens']*10)/1e6
        calibration=[r for r in calls if r['split']=='pilot' and not r['providerError'] and r['startedAt']>=freeze.get('calibrationAfter','')]
        if calibration and not (cell/'projection.json').exists():
            counts=collections.Counter(r['contestant'] for r in calibration)
            means={c:sum(r['costUsd'] for r in calibration if r['contestant']==c)/counts[c] for c in counts}
            # Planning rate from completed pre-existing Flash Lite, without consuming any new TEST outcome.
            prior=[r for r in old if r['model']=='gemini-3.5-flash-lite' and r['contestant']=='pair-ledger' and r['split'] in ('fixtures','validity','dev','test')]
            rate=sum(r['callCount'] for r in prior)/len(prior)
            n=18+20+90+173
            projection={'model':model,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'answeredCalls':len(calibration),
                'calibrationUsd':sum(r['costUsd'] for r in calibration),'callsPerContestant':dict(counts),'meanUsdPerCall':means,
                'projectedPrimaryCalls':n*rate,'projectedPromptfooCalls':n*2,'planningRate':rate,
                'method':'Five calls from sealed pilot prefix; per-contestant mean cost times 301 comparisons. Primary calls per comparison use completed Flash Lite runtime counts. No calibration outcome drives tuning.',
                'projectedCellUsd':sum(r['costUsd'] for r in calls)+n*(means.get('pair-ledger',0)*rate+means.get('promptfoo',0)*2),
                'worstContractCallCountUsd':sum(r['costUsd'] for r in calls)+n*(means.get('pair-ledger',0)*6+means.get('promptfoo',0)*2),
                'capUsd':freeze['capUsd'],'separateFromOld35UsdCap':True}
            if len(calibration)==5 and len(means)==2:write(cell/'projection.json',projection)
        peer=[r for r in decisions if r['split']=='test' and r['contestant']=='promptfoo']
        scores=[]
        for contestant in ['pair-ledger','promptfoo']:
            data=[r for r in decisions if r['split']=='test' and r['contestant']==contestant]
            selected=[r for r in calls if r['contestant']==contestant]
            test_calls=[r for r in selected if r['split']=='test']
            reads=[x for r in decisions if r['contestant']==contestant for x in r.get('details',{}).get('reads',[])]
            reasks=[x for x in reads if any(s['ruleId']=='ledger.reask' for s in x['parseSteps'])]
            capped=[r for r in selected if (r['providerMeta'].get('incompleteDetails') or {}).get('reason')=='max_output_tokens' or
                (r.get('usage') or {}).get('output_tokens',0)>=4096 or 'max_tokens' in str(r['providerMeta'].get('stopReason',''))]
            lost=[r['id'] for r in data if r['graderErrors'] and any(c['id']==r['id'] and c['split']=='test' for c in capped)]
            scores.append({'contestant':contestant,**summarize(items,data,peer if contestant=='pair-ledger' else None),
                'allPhaseCostUsd':sum(r['costUsd'] for r in selected),'testCostUsdIncludingTransport':sum(r['costUsd'] for r in test_calls),
                'orderedReadings':len(reads),'schemaReasks':len(reasks),'schemaReaskUsd':sum(a.get('costUsd',0) for x in reasks for a in x['attempts'][1:]),
                'outputCapCalls':len(capped),'testItemsLostToOutputCap':lost,'missingTestItems':[x['id'] for x in items if x['id'] not in {r['id'] for r in data}],
                'http429':sum(r.get('httpStatus')==429 for r in selected),'transportFailures':sum(r['providerError'] for r in selected),
                'sessionLimitNoAnswers':sum(r['providerError'] and 'session limit' in r['text'].lower() for r in selected),
                'tokens':{'input':sum((r.get('usage') or {}).get('input_tokens',0) for r in selected),
                    'output':sum((r.get('usage') or {}).get('output_tokens',0) for r in selected),
                    'cacheRead':sum((r.get('usage') or {}).get('cache_read_input_tokens',(r.get('usage') or {}).get('input_tokens_details',{}).get('cached_tokens',0)) for r in selected),
                    'cacheWrite':sum((r.get('usage') or {}).get('cache_creation_input_tokens',(r.get('usage') or {}).get('input_tokens_details',{}).get('cache_write_tokens',0)) for r in selected)}})
        report={'model':model,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scores':scores,'longerWins':longer,
            'complete':all(s['pairs']==173 for s in scores) and all(sum(r['split']==split for r in decisions)==n for split,n in freeze['phaseComparisons'].items()),'spend':spending(rows(cell/'spend.jsonl')),
            'phaseCounts':dict(collections.Counter(r['split'] for r in decisions)),
            'projection':json.loads((cell/'projection.json').read_text()) if (cell/'projection.json').exists() else None,
            'freezeSha256':hashlib.sha256((cell/'freeze.json').read_bytes()).hexdigest()}
        write(cell/'report.json',report);reports.append(report)
    lines=['## Additive Sonnet and GPT-6.1 writing cells','','- Authorization: separate budgets on top of the original 35 USD. GPT-6.1 cap is 32 USD including holds after the network recovery amendment; Sonnet cap is 45 USD after the cache-only runtime fix and five-call recalibration. Existing reservations stay unchanged.',
        '- Both contestants use the same model inside each cell. Gemini 3.8 remains parked. Reader-first stays in its separate legacy rows.',
        '- Runtime amendment: ten consecutive healthy probes 30 seconds apart on the active provider; concurrency two, one model cell at a time. Three consecutive connection failures pause ten minutes before a fresh gate. Missing-only transport recovery has no cycle limit, including the 12 formerly exhausted calls. Returned answers are never submitted again.',
        '- The 16:00 UTC cutoff is removed for these two new cells because of the host network pause; no TEST result was seen before this amendment. Unknown holds remain reserved. Explicit zero-token provider errors settle at their real zero cost. TEST starts only after 20 consecutive healthy DEV calls; transport-missing items prevent final status.',
        '- Frozen core, pool, order, schema re-ask and scoring remain fixed. Five pilot calls calibrate cost before fixtures, validity, DEV and the full TEST.',
        '- Both models use medium reasoning and a 4096 total output-token cap. Sonnet uses the lean Haiku CLI route with alias sonnet and empty working directory.',
        '- GPT-6.1 uses Responses without temperature. Standard USD per million tokens: input 2, cached input 0.10, cache writes 2.50, output 10. Source: https://developers.openai.com/api/docs/pricing, read 2026-10-13.',
        '- Sonnet cost comes from native total_cost_usd. Fixed thinking budget 2048 may be ignored by adaptive reasoning; total output is capped at 4096. Source: https://code.claude.com/docs/en/env-vars.',
        '', '| Model | Our TEST score | Promptfoo TEST score | Longer-wins | Paired p | Actual / held USD | Status |', '| --- | --- | --- | --- | --- | --- | --- |']
    for r in reports:
        a,b=r['scores'];p=a.get('comparison',{}).get('mcnemarTwoSided');n=a['games']
        lines.append(f"| {r['model']} | {a['correct']}/{n} | {b['correct']}/{b['games']} | {longer['correct']}/{longer['games']} | {p} | {r['spend']['actualUsd']:.8f} / {r['spend']['heldUsd']:.8f} | {'complete' if r['complete'] else 'pending'} |")
        lines+=['',f"### {r['model']}",f"- Freeze SHA256: `{r['freezeSha256']}`. Artifact folder: `examples/ledger-wp/cells/{r['model']}/`.",f"- Calibration projection: {json.dumps(r['projection'],ensure_ascii=False)}"]
        for s in r['scores']:
            lines.append(f"- {s['contestant']}: TEST cost {s['testCostUsdIncludingTransport']:.8f} USD; all-phase cost {s['allPhaseCostUsd']:.8f} USD; output-cap calls {s['outputCapCalls']}; lost TEST items {len(s['testItemsLostToOutputCap'])}; missing TEST items {len(s['missingTestItems'])}; schema re-asks {s['schemaReasks']}/{s['orderedReadings']} costing {s['schemaReaskUsd']:.8f} USD; HTTP 429 {s['http429']}; zero-cost session-limit no-answers {s['sessionLimitNoAnswers']}; tokens {json.dumps(s['tokens'])}.")
        if p is not None:lines.append(f"- Paired test: {json.dumps(a['comparison'])}. Game McNemar is nominal; interpret with the request-cluster interval. Any positive claim awaits family multiplicity handling.")
    section='\n'.join(lines)+'\n'
    base=DOSSIER.read_text();marker='\n## Additive Sonnet and GPT-6.1 writing cells\n'
    if marker in base:base=base.split(marker)[0]
    DOSSIER.write_text(base.rstrip()+'\n\n'+section)
    (HERE/'results/frontier-report.md').write_text(section)
    print(json.dumps([{k:r[k] for k in ['model','complete','spend','projection','phaseCounts']} for r in reports],indent=2))
if __name__=='__main__':main()
