"""Separate dialect tables; reuse the pre-sealed exact tests and family bootstrap."""
import importlib.util
from common import *
from score import summary,holm
spec=importlib.util.spec_from_file_location('dialect_runner',HERE/'dialect-run.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)

def main():
    calls=d.variant_records();by_key={c['request_sha256']:c for c in calls}
    assert len(calls)==len(by_key)
    lookup={(r['model'],r['id'],r['side']):r for r in d.all_requests()}
    tables=[];all_units=[]
    for model in d.VARIANT_MODELS:
        for row in ROWS:
            for comparator in (('peer','peer-full-state') if row=='goal' else ('peer',)):
                units=[]
                for case in cases(row):
                    left=lookup[model,case['id'],'audit'];right=lookup[model,case['id'],comparator]
                    a=by_key.get(left['request_sha256']);b=by_key.get(right['request_sha256'])
                    if not a or not b:continue
                    ao=d.outcome(a['text'],'audit',row) if a['success'] else 'inconclusive'
                    bo=d.outcome(b['text'],comparator,row) if b['success'] else 'inconclusive'
                    truth='pass' if case['truth'] else 'fail'
                    units.append({'model':model,'row':row,'comparator':comparator,'id':case['id'],'family':case['kind'],
                         'truth':truth,'ours':ao,'peer':bo,'ours_right':ao==truth,'peer_right':bo==truth,
                         'ours_request':left['request_sha256'],'peer_request':right['request_sha256']})
                all_units.extend(units)
                entry={'model':model,'row':row,'comparator':comparator,**summary(units,384)}
                for side,field in [('ours','ours_request'),('peer','peer_request')]:
                    used={u[field] for u in units};cost=sum(by_key[k]['measured_usd'] or 0 for k in used)
                    entry[side+'_cost_usd']=cost;entry[side+'_cost_per_100']=100*cost/len(units) if units else None
                entry['discordant_ids']=[u['id'] for u in units if u['ours_right']!=u['peer_right']]
                tables.append(entry)
        for equal in (False,True):
            units=[u for u in all_units if u['model']==model and (u['comparator']==('peer-full-state' if equal else 'peer') if u['row']=='goal' else u['comparator']=='peer')]
            tables.append({'model':model,'row':'pooled-equal-evidence' if equal else 'pooled-default','comparator':'mixed',**summary(units,1536)})
    correction=holm({t['model']:t['two_sided_p'] if t['complete'] else 1 for t in tables if t['row']=='pooled-default'},18)
    for t in tables:
        t['nominal_verdict']='PENDING' if not t['complete'] else 'LOSS' if t['losses']>t['wins'] and t['two_sided_p']<.05 else 'nominal lead' if t['wins']>t['losses'] and t['two_sided_p']<.05 else 'TIE (not equivalence)'
        if t['row']=='pooled-default':t['holm18_missing_as_one']=correction[t['model']]
    seal=json.loads((d.DEST/'seal.json').read_text())
    output={'generated':stamp(),'core_commit':seal['core_commit'],'seal_sha256':digest(d.DEST/'seal.json'),'tables':tables,
        'unique_calls':len(calls),'failed_calls':sum(not c['success'] for c in calls),'measured_usd':sum(c['measured_usd'] or 0 for c in calls),
        'primary_plus_dialect_usd':d.known_total(),'resolved_models':sorted({m for c in calls for m in (c.get('resolved_model') if isinstance(c.get('resolved_model'),list) else [c.get('resolved_model')]) if m})}
    dump(d.DEST/'scores.json',output);dump(d.DEST/'decisions.json',all_units)
    lines=['# Separate core-dialect variant','',f'Generated {output["generated"]}. Source: `comparisons/ledger-hard/dialect/scores.json`, `decisions.json`, `attempts.jsonl` and `calls.jsonl`.','',
           f'Core `{seal["core_commit"]}`; variant seal SHA-256 `{output["seal_sha256"]}`. This is the same sealed case cohort under a separately frozen transport and reasoning setting, not new data. No primary request key or answer is reused.','',
           'Luna and Gemini use medium for both contestants. Candidate output uses the native core schema dialect; peer prompt bytes remain unchanged. Haiku uses the core scratchpad instruction and last-JSON candidate decoder.','',
           '| Model | Row / evidence | Paired / sealed | Ours | Peer | W | L | Exact two-sided p | Exact one-sided p | Status |','|---|---|---:|---:|---:|---:|---:|---|---|---|']
    for t in tables:lines.append(f'| {t["model"]} | {t["row"]}/{t["comparator"]} | {t["n"]}/{t["sealed_n"]} | {t["ours"]} | {t["peer"]} | {t["wins"]} | {t["losses"]} | {t["two_sided_exact"]} = {t["two_sided_p"]:.8g} | {t["one_sided_exact"]} = {t["one_sided_p"]:.8g} | {t["nominal_verdict"]} |')
    lines+=['','| Model | Row | Wilson ours | Wilson peer | Family bootstrap difference | Inconclusive ours/peer | USD/100 ours/peer |','|---|---|---|---|---|---|---|']
    def interval(v):return 'pending' if v is None else '['+', '.join(f'{100*x:.3f}%' for x in v)+']'
    for t in tables:
        cost='/'.join(f'{t[s+"_cost_per_100"]:.6f}' if t[s+'_cost_per_100'] is not None else 'pending' for s in ('ours','peer')) if 'ours_cost_per_100' in t else 'see rows'
        lines.append(f'| {t["model"]} | {t["row"]}/{t["comparator"]} | {interval(t["ours_wilson95"])} | {interval(t["peer_wilson95"])} | {interval(t["family_bootstrap95"]["difference"] if t["family_bootstrap95"] else None)} | {t["ours_inconclusive"]}/{t["peer_inconclusive"]} | {cost} |')
    lines+=['',f'{len(calls)} completed unique requests; {output["failed_calls"]} final transport failures. Variant spend USD {output["measured_usd"]:.8f}. Primary plus variant measured spend USD {output["primary_plus_dialect_usd"]:.8f} of USD 10.',
      '',f'Resolved model versions: {output["resolved_models"]}.',
      '', 'Exact tests and bootstrap use the original sealed statistics functions. Rows are descriptive secondary comparisons. The global 18-cell Holm table remains the collator\'s responsibility; conservative missing-as-one pooled adjustments are in scores.json.',
      '', 'All three model rows have explicit per-call raw usage. Luna pricing: USD 0.10 input, 0.01 cached input, 0.50 output per million. Gemini: USD 0.75 input and 3.75 output including thinking per million. Sources verified 2026-10-13: https://developers.openai.com/api/docs/models/gpt-6-luna and https://ai.google.dev/gemini-api/docs/pricing. Haiku uses CLI-reported cost.',
      '', 'Failures over 5% in a rolling 50 Luna attempts reduce variant concurrency from four to two. Every attempt and backoff is logged. Worker results are fsynced before the future returns. A drain file stops new dispatch and waits for owned requests.', '']
    report='\n'.join(lines);assert '\u2014' not in report and '\u2013' not in report
    (d.DEST/'REPORT.md').write_text(report)
    print(json.dumps({k:output[k] for k in ('unique_calls','failed_calls','measured_usd','primary_plus_dialect_usd')}))

if __name__=='__main__':main()
