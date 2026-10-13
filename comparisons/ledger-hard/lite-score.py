"""Offline Flash-Lite verification and exact tables, separated by experiment."""
import argparse, collections
from common import *
from score import summary
r=load_module('flash_lite_runner',HERE/'lite-run.py')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--require-complete',action='store_true');args=parser.parse_args()
    seal=r.verify_seal();mode=json.loads((r.DEST/'reasoning-applied.json').read_text())['reasoning_applied']
    requested=r.requests(mode);answers=r.all_answers();by={a['request_sha256']:a for a in answers}
    assert len(by)==len(answers)
    keys={x['request_sha256'] for x in requested};assert set(by)<=keys
    if args.require_complete:assert set(by)==keys
    starts=r.lines(r.DEST/'starts.jsonl');counts=collections.Counter(x['request_sha256'] for x in starts)
    assert all(counts[k]==1 for k in by),'An answered request was dispatched again'
    events=r.lines(r.DEST/'attempts.jsonl');active=maximum=0
    for event in events:
        if event['event']=='backoff':assert event['seconds'] in (10,20,30,60,180);continue
        active+=1 if event['event']=='start' else -1
        assert 0<=active<=8;maximum=max(maximum,active)
    assert active==0
    for a in answers:
        assert a['model']==r.MODEL and a['reasoning_applied']==mode
        assert (a.get('error') or {}).get('status') not in (402,429)
        if a.get('provider_response'):
            assert a['resolved_model']==r.MODEL
            assert abs(a['measured_usd']-r.cost(a['usage']))<1e-12
        decode=native.outcome if a['experiment']=='primary' else r.variant.outcome
        assert a['outcome']==(decode(a['text'],a['side'],a['row']) if a['success'] else 'inconclusive')
    result={'generated':stamp(),'model':r.MODEL,'reasoning_applied':mode,'seal_sha256':digest(r.DEST/'seal.json'),'experiments':{},'unique_calls':len(answers),'planned_unique':len(keys),'complete':set(by)==keys,'measured_usd':sum(a['measured_usd'] for a in answers),'max_concurrent_http':maximum}
    assert result['measured_usd']<=seal['cell_cap_usd']
    assert seal['prior_measured_usd']+.4+result['measured_usd']<=seal['overall_cap_usd']
    report=['# Separate Gemini 3.5 Flash-Lite cell','',f'Generated {result["generated"]}. Sources: `flash-lite/seal.json`, `requests.json`, `attempts.jsonl`, both `calls.jsonl` journals and `scores.json`.','',
            f'Model `{r.MODEL}`, reasoning `{mode}` for both contestants and both experiments. This is the same sealed cohort, 384 cases per row. Results never mix with Gemini 3.8.','',
            f'{len(answers)}/{len(keys)} unique requests recorded. Model-cell measured spend USD {result["measured_usd"]:.8f}, cap USD {seal["cell_cap_usd"]:g}. Combined measured spend plus the USD 0.40 lost-attempt reserve is USD {seal["prior_measured_usd"]+.4+result["measured_usd"]:.8f}, cap USD {seal["overall_cap_usd"]:g}.','',
            'Standard paid pricing, verified 2026-10-13: USD 0.30 ordinary input, USD 0.03 cached input, USD 2.50 output including thinking per million tokens. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing). Raw usage and applied reasoning remain recorded per call.','']
    decisions=[]
    for experiment in ('primary','dialect'):
        lookup={(x['id'],x['side']):x for x in requested if x['experiment']==experiment}
        replay=json.loads((r.DEST/experiment/'peer-native-decoder.json').read_text())
        expected={k for k,a in by.items() if a['experiment']==experiment and a['success'] and a['side'].startswith('peer')}
        assert set(replay)==expected and all(by[k]['outcome']==value for k,value in replay.items())
        units=[];tables=[]
        for row in ROWS:
            for peer in (('peer','peer-full-state') if row=='goal' else ('peer',)):
                group=[]
                for c in cases(row):
                    ak=lookup[c['id'],'audit']['request_sha256'];bk=lookup[c['id'],peer]['request_sha256']
                    if ak not in by or bk not in by:continue
                    a,b=by[ak],by[bk];truth='pass' if c['truth'] else 'fail'
                    group.append({'experiment':experiment,'model':r.MODEL,'row':row,'comparator':peer,'id':c['id'],'family':c['kind'],'truth':truth,'ours':a['outcome'],'peer':b['outcome'],'ours_right':a['outcome']==truth,'peer_right':b['outcome']==truth,'ours_request':ak,'peer_request':bk})
                units.extend(group)
                t={'model':r.MODEL,'row':row,'comparator':peer,**summary(group,384)}
                for side,field in [('ours','ours_request'),('peer','peer_request')]:
                    spent=sum(by[k]['measured_usd'] for k in {u[field] for u in group})
                    t[side+'_cost_per_100']=100*spent/len(group) if group else None
                tables.append(t)
        for equal in (False,True):
            selected=[u for u in units if u['comparator']==('peer-full-state' if equal and u['row']=='goal' else 'peer')]
            tables.append({'model':r.MODEL,'row':'pooled-equal-evidence' if equal else 'pooled-default','comparator':'mixed',**summary(selected,1536)})
        for t in tables:t['nominal_verdict']='PENDING' if not t['complete'] else 'LOSS' if t['losses']>t['wins'] and t['two_sided_p']<.05 else 'nominal lead' if t['wins']>t['losses'] and t['two_sided_p']<.05 else 'TIE (not equivalence)'
        result['experiments'][experiment]={'tables':tables,'native_peer_answers_checked':len(replay),'unique_calls':sum(a['experiment']==experiment for a in answers),'measured_usd':sum(a['measured_usd'] for a in answers if a['experiment']==experiment)}
        decisions.extend(units)
        report+=['## '+experiment,'','| Row / evidence | Paired / sealed | Ours | Peer | W | L | Exact two-sided p | Exact one-sided p | Status |','|---|---:|---:|---:|---:|---:|---|---|---|']
        for t in tables:report.append(f'| {t["row"]}/{t["comparator"]} | {t["n"]}/{t["sealed_n"]} | {t["ours"]} | {t["peer"]} | {t["wins"]} | {t["losses"]} | {t["two_sided_exact"]} = {t["two_sided_p"]:.8g} | {t["one_sided_exact"]} = {t["one_sided_p"]:.8g} | {t["nominal_verdict"]} |')
        report+=['','| Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference | Inconclusive ours/peer | USD/100 ours/peer |','|---|---|---|---|---|---|']
        def interval(v):return 'pending' if v is None else '['+', '.join(f'{100*x:.3f}%' for x in v)+']'
        for t in tables:
            cost='/'.join('pending' if t[s+'_cost_per_100'] is None else f'{t[s+"_cost_per_100"]:.6f}' for s in ('ours','peer')) if 'ours_cost_per_100' in t else 'see rows'
            report.append(f'| {t["row"]}/{t["comparator"]} | {interval(t["ours_wilson95"])} | {interval(t["peer_wilson95"])} | {interval(t["family_bootstrap95"]["difference"] if t["family_bootstrap95"] else None)} | {t["ours_inconclusive"]}/{t["peer_inconclusive"]} | {cost} |')
        report.append('')
    report+=['## Interpretation and freeze','',
      'The nominal win rule is unchanged: higher accuracy and exact two-sided McNemar p below 0.05. Multiplicity-adjusted matrix wins remain the collator\'s decision. This added model expands the original matrix and cannot silently inherit an 18-cell correction. Family bootstrap intervals retain synthetic-family uncertainty.', '',
      'Default goal inputs remain information-asymmetric. The pooled equal-evidence comparison replaces that goal row with final state supplied to both. No pool counts goal twice. This is a new model measurement on the same cohort, not an independent replication. No content is retried. Transport failures and provider limits remain separate from judge outcomes.', '',
      f'Seal SHA-256: `{result["seal_sha256"]}`. Original case seal: `{seal["same_cohort_seal_sha256"]}`. Reasoning application: `{digest(r.DEST/"reasoning-applied.json")}`. Statistics source: `{digest(HERE/"score.py")}`. Per-file hashes are retained inside the committed seal.','']
    content='\n'.join(report);assert '\u2014' not in content and '\u2013' not in content
    dump(r.DEST/'scores.json',result);dump(r.DEST/'decisions.json',decisions);(r.DEST/'REPORT.md').write_text(content)
    print(json.dumps({k:result[k] for k in ('model','reasoning_applied','unique_calls','complete','measured_usd','max_concurrent_http')}))

if __name__=='__main__':main()
