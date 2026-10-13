"""Diagnostic expert-choice capacity with the computed checks, never a router."""
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from moj import pointwise_router as r, verify_prior as v, verify_evidence as e

audit=json.loads((Path(__file__).parent/'report.json').read_text())
proof={x['id']:x['candidate_correct'] for x in audit['checks'] if x['status']=='proved'}
edits={x['id']:x['corrected_label'] for x in audit['corrections']}
items=v.items('valid');stores=r.load_stores();out={}
for mode in ('official','proof_corrected_only'):
    population=[{**i,'label':edits.get(i['id'],i['label'])} for i in items] if mode!='official' else items
    cells={}
    for source in ('old_experts','old_plus_error_hunt','old_plus_computed','old_plus_both'):
        ds={}
        for i in population:
            ps=[r.old_signal(i,n,stores)['pA'] for n in ('pw_ref_luna','pw_s2v_luna')]
            second=v.second(i)
            if second:ps.append(second['pA'])
            if source in ('old_plus_error_hunt','old_plus_both'):
                ps.append(e.scores(i,stores)['base_plus_audit'])
            if source in ('old_plus_computed','old_plus_both') and i['id'] in proof:
                ps.append(float(proof[i['id']]))
            best=max(r.score_verdict(r.verdict(p),i['label']) for p in ps if p is not None)
            ds[r.key(i)]={'verdict':i['label'],'score_override':best}
        cells[source]=r.metrics(population,ds)
    out[mode]=cells
r.save(Path(__file__).parent/'capacity.json',{'warning':'Gold-label per-item oracle; not an implementable route or a general bound. Computed checks are hand formalized diagnostics, not a learned judge. No validation-based routing is introduced.', 'computed_validation_coverage':sum(i['id'] in proof for i in items),'cells':out})
print(json.dumps({mode:{name:100*c['accuracy'] for name,c in cells.items()} for mode,cells in out.items()},indent=2))
