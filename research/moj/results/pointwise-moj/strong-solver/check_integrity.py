"""Verify experiment boundaries, provenance, accounting and unchanged freezes."""
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from moj import verify_strong_solver as s


def main():
    items=s.v.items('tune')+s.v.items('valid')
    cfg=json.loads(s.CONFIG.read_text());pins=json.loads((s.OUT/'source-pins.json').read_text())
    assert s.sha(s.r.ROOT/'moj/client.py')==pins['client_sha256']
    assert s.sha(s.r.ROOT/'configs/pw-final-frozen.json')==pins['initial_frozen_config_sha256']
    assert s.sha(s.r.OUT/'label-audit/report.json')==pins['label_audit_sha256']
    assert s.client.digest(s.SOLVE_SYSTEM)==pins['solver_prompt_sha256']
    assert s.client.digest(s.MATCH)==pins['compare_question_sha256']
    freeze=json.loads((s.r.OUT/'two-step-terrain/FREEZE.json').read_text())
    for p,expected in freeze['files'].items():assert s.sha(s.r.ROOT/p)==expected,p
    assert set(cfg['tuning_keys'])=={s.r.key(i) for i in s.v.items('tune')}
    assert not ({s.t.group(i) for i in s.v.items('tune')}&{s.t.group(i) for i in s.v.items('valid')})
    rec=s.Recorder(True);answered=[x for x in rec.rows if x.get('answer') is not None]
    assert len(answered)==190
    bykey={x['key']:x for x in answered};cost={m:0. for m in s.MODELS};health={m:0 for m in s.MODELS}
    cache_writes=0;sonnet_cache=0;finishes={}
    for i in items:
        for m in s.MODELS:
            sig=s.get(i,m);row=bykey[sig['solver_key']];a=row['answer'];u=a['raw']['usage']
            assert row['request']==s.request(m,i['question'])
            assert s.client.digest(row['request'])==row['key']
            if i['half']=='valid':assert row['time']>=cfg['frozen_at']
            cost[m]+=a['usd'];health[m]+=sig['healthy']
            finishes[a['finish']]=finishes.get(a['finish'],0)+1
            if m=='sol':
                assert s.sol_cost(a['raw'])==a['usd']
                cache_writes+=u['prompt_tokens_details'].get('cache_write_tokens',0)
            else:sonnet_cache+=u.get('cache_creation_input_tokens',0)+u.get('cache_read_input_tokens',0)
    assert sonnet_cache==0
    assert sum(finishes.values())==190
    assert abs(sum(cost.values())-rec.spend())<1e-9
    assert rec.spend()<=10
    # Verify only this owned round. Secret values never enter logs or exceptions.
    paths=[p for p in s.OUT.rglob('*') if p.is_file() and '__pycache__' not in str(p)]
    for keyfile in [s.client.OPENAI_KEY,s.client.JEV_KEYS['gateway']]:
        secret=Path(keyfile).expanduser().read_bytes().strip()
        assert len(secret)>10
        for p in paths:
            assert secret not in p.read_bytes(),'Credential found in owned artifact: '+p.name
    result={'tuning_n':46,'validation_n':49,'healthy_by_model':health,'finish_counts':finishes,
            'sonnet_cached_tokens':sonnet_cache,'sol_cache_write_tokens':cache_writes,
            'usd_by_model':cost,'accounted_usd':rec.spend(),'budget_usd':10,
            'tuning_validation_groups_disjoint':True,'validation_calls_after_freeze':True,
            'original_prompts_and_client_unchanged':True,'three_accepted_cells_unchanged':True,
            'proof_corrections_unchanged':True,'secret_scan_pass':True}
    s.r.save(s.OUT/'integrity.json',result)
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
