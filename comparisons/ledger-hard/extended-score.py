"""Offline additional-model tables. The original exact statistics remain unchanged."""
import argparse,collections
from common import *
from score import summary
r=load_module('additional_model_runner',HERE/'extended-run.py')

def main(cell,require_complete=False):
    seal=r.verify(cell);dest=HERE/cell;requested=r.requests(dest);answers=r.answers(dest);by={a['request_sha256']:a for a in answers}
    keys={x['request_sha256'] for x in requested};assert len(by)==len(answers) and set(by)<=keys
    if (HERE/'network-amendment.json').exists():assert set(by)==keys,'Owner rule: no scores while any sealed request is missing a model answer'
    if require_complete:assert set(by)==keys
    starts=collections.Counter(x['request_sha256'] for x in r.lines(dest/'starts.jsonl'));assert all(starts[k]==1 for k in by)
    active=maximum=0;events=r.lines(dest/'attempts.jsonl')
    for x in events:
        if x['event']=='backoff':assert x['seconds'] in (10,20,30,60,180);continue
        active+=1 if x['event']=='start' else -1;maximum=max(maximum,active);assert 0<=active<=seal['concurrency']
    assert active==0
    for a in answers:
        assert a['model']==seal['model'];assert (a.get('error') or {}).get('status') not in (402,429)
        if a.get('provider_response'):
            assert a['model_match'] and a['generated_tokens']<=4096
            if cell=='gpt-6.1-sol':assert abs(a['measured_usd']-r.sol_cost(a['usage']))<1e-12 and a['reasoning_applied']=='medium'
        decode=native.outcome if a['experiment']=='primary' else r.variant.outcome
        assert a['outcome']==(decode(a['text'],a['side'],a['row']) if a['success'] else 'inconclusive')
    measured,reserved=r.accounting(dest);cap=r.cell_cap(dest);assert measured+reserved<=cap
    result={'generated':stamp(),'model':seal['model'],'cell':cell,'reasoning':'medium','unique_calls':len(answers),'planned_unique':len(keys),'complete':set(by)==keys,
            'measured_usd':measured,'unknown_attempt_reserve_usd':reserved,'max_concurrent_calls':maximum,'seal_sha256':digest(dest/'seal.json'),'experiments':{}}
    decisions=[];lost=[]
    report=[f'# Additional model: {seal["model"]}','',f'Generated {result["generated"]}. Sources: `{cell}/seal.json`, `requests.json`, `attempts.jsonl`, both `calls.jsonl` files and `scores.json`.','',
            f'{len(answers)}/{len(keys)} unique requests recorded; 384 sealed cases per row in each experiment. Both contestants use medium reasoning. Each experiment remains separate.', '',
            f'Measured USD {measured:.8f}; unknown-attempt reserve USD {reserved:.8f}; model-cell cap USD {cap}. First five sealed requests form the cost pilot and are retained once. `pilot.json` and `cost-forecast.json` record cost-only projections.', '',
            'The total generated-token limit is 4096, including hidden reasoning. No answer is retried, including malformed or token-limited output. Token-limit and other lost items are listed in `lost-items.json`; they remain in the denominator and earn no credit.', '']
    if cell=='gpt-6.1-sol':report+=['Standard short-context prices per million tokens, verified 2026-10-13: input USD 2, cached input USD 0.10, cache write USD 2.50, output including reasoning USD 10. [OpenAI pricing](https://developers.openai.com/api/docs/pricing). The route is the Responses API; temperature is omitted. Raw token counts and reported reasoning are retained per call.','']
    else:report+=['Sonnet uses the Claude print-mode route, alias `sonnet`, an empty folder, explicit grading system text, disabled settings/tools/MCP/session persistence, and safe mode. `CLAUDE_CODE_MAX_OUTPUT_TOKENS=4096` bounds adaptive thinking plus visible output; a fixed thinking budget is not supported by Sonnet 5.5. CLI-reported `total_cost_usd` is authoritative. [Claude environment documentation](https://code.claude.com/docs/en/env-vars).','']
    for experiment in ('primary','dialect'):
        lookup={(x['id'],x['side']):x for x in requested if x['experiment']==experiment};units=[];tables=[]
        replay=json.loads((dest/experiment/'peer-native-decoder.json').read_text())
        expected={k for k,a in by.items() if a['experiment']==experiment and a['success'] and a['side'].startswith('peer')}
        assert set(replay)==expected and all(by[k]['outcome']==v for k,v in replay.items())
        for row in ROWS:
            for peer in (('peer','peer-full-state') if row=='goal' else ('peer',)):
                group=[]
                for c in cases(row):
                    ak=lookup[c['id'],'audit']['request_sha256'];bk=lookup[c['id'],peer]['request_sha256']
                    if ak not in by or bk not in by:continue
                    a,b=by[ak],by[bk];truth='pass' if c['truth'] else 'fail'
                    group.append({'experiment':experiment,'model':seal['model'],'row':row,'comparator':peer,'id':c['id'],'family':c['kind'],'truth':truth,'ours':a['outcome'],'peer':b['outcome'],'ours_right':a['outcome']==truth,'peer_right':b['outcome']==truth,'ours_request':ak,'peer_request':bk})
                units.extend(group);t={'row':row,'comparator':peer,**summary(group,384)}
                for side,field in [('ours','ours_request'),('peer','peer_request')]:t[side+'_cost_usd']=sum(by[k].get('measured_usd') or 0 for k in {u[field] for u in group})
                tables.append(t)
        for equal in (False,True):
            selected=[u for u in units if u['comparator']==('peer-full-state' if equal and u['row']=='goal' else 'peer')]
            t={'row':'pooled-equal-evidence' if equal else 'pooled-default','comparator':'mixed',**summary(selected,1536)}
            for side,field in [('ours','ours_request'),('peer','peer_request')]:t[side+'_cost_usd']=sum(by[k].get('measured_usd') or 0 for k in {u[field] for u in selected})
            tables.append(t)
        for t in tables:t['nominal_verdict']='PENDING' if not t['complete'] else 'LOSS' if t['losses']>t['wins'] and t['two_sided_p']<.05 else 'nominal lead' if t['wins']>t['losses'] and t['two_sided_p']<.05 else 'TIE (not equivalence)'
        selected=[a for a in answers if a['experiment']==experiment]
        result['experiments'][experiment]={'tables':tables,'native_peer_answers_checked':len(replay),'unique_calls':len(selected),'cost_by_contestant':{s:sum(a.get('measured_usd') or 0 for a in selected if a['side']==s) for s in ('audit','peer','peer-full-state')}}
        decisions.extend(units)
        for e in [x for x in requested if x['experiment']==experiment]:
            a=by.get(e['request_sha256'])
            if a and a.get('item_lost'):lost.append({k:e[k] for k in ('experiment','id','row','side','request_sha256')}|{'token_limit':a.get('token_limit_lost',False),'success':a['success'],'outcome':a['outcome'],'error':a.get('error')})
        report+=['## '+experiment,'','| Row / evidence | Paired / sealed | Ours | Promptfoo | W | L | Exact two-sided p | USD ours / peer | Lost ours / peer | Verdict |','|---|---:|---:|---:|---:|---:|---|---|---|---|']
        for t in tables:report.append(f'| {t["row"]}/{t["comparator"]} | {t["n"]}/{t["sealed_n"]} | {t["ours"]} | {t["peer"]} | {t["wins"]} | {t["losses"]} | {t["two_sided_exact"]} = {t["two_sided_p"]:.8g} | {t["ours_cost_usd"]:.8f} / {t["peer_cost_usd"]:.8f} | {t["ours_inconclusive"]}/{t["peer_inconclusive"]} | {t["nominal_verdict"]} |')
        report+=['','| Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference |','|---|---|---|---|']
        def interval(v):return 'pending' if v is None else '['+', '.join(f'{100*x:.3f}%' for x in v)+']'
        for t in tables:report.append(f'| {t["row"]}/{t["comparator"]} | {interval(t["ours_wilson95"])} | {interval(t["peer_wilson95"])} | {interval(t["family_bootstrap95"]["difference"] if t["family_bootstrap95"] else None)} |')
        report.append('')
    result['lost_entries']=len(lost);result['token_limited_entries']=sum(x['token_limit'] for x in lost);result['lost_unique_requests']=len({x['request_sha256'] for x in lost})
    report += ['## Losses and interpretation','',f'{result["lost_entries"]} case-side entries have no usable verdict, covering {result["lost_unique_requests"]} unique requests. {result["token_limited_entries"]} entries reach the output/thinking cap. Full keys and causes remain in `lost-items.json`. No 65536-token request is configured.', '',
               'Nominal tests use the unchanged exact two-sided McNemar calculation and 20000 family-bootstrap draws. Global multiplicity correction belongs to the collator. The same synthetic cohort is not independent replication. Default goal is information-asymmetric; pooled equal-evidence replaces it with final state supplied to both. Costs shown for overlapping rows and pools must not be summed as additional spend.', '',
               f'Seal SHA-256: `{digest(dest/"seal.json")}`. Original case seal: `{seal["original_seal_sha256"]}`. Per-file hashes remain in the seal. Gemini 3.8 is parked and its journals remain unchanged.','']
    content='\n'.join(report);assert '\u2014' not in content and '\u2013' not in content
    dump(dest/'scores.json',result);dump(dest/'decisions.json',decisions);dump(dest/'lost-items.json',lost);(dest/'REPORT.md').write_text(content)
    print(json.dumps({k:result[k] for k in ('model','complete','unique_calls','measured_usd','lost_entries','token_limited_entries')}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('cell',choices=r.CELLS);p.add_argument('--require-complete',action='store_true');a=p.parse_args();main(a.cell,a.require_complete)
