"""Reproduce the frozen report, ablations and call provenance without network."""
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import unittest
from unittest.mock import patch
from moj import pointwise_router as r
from moj.pointwise import run_expert

out=r.OUT/'v3'
config=json.loads((r.ROOT/'configs/pw-router-v3-frozen.json').read_text())
base=json.loads(r.FROZEN.read_text())
items=r.rows('valid',True);stores=r.load_stores(True)
recorded=json.loads((out/'validation-decisions.json').read_text())
with patch.object(socket,'socket',side_effect=AssertionError('offline audit cannot access network')):
    fresh={r.key(i):r.decide(i,stores,config,config['calibration']) for i in items}
    assert fresh==recorded
    prior=json.loads((r.OUT/'validation-decisions.json').read_text())
    assert {r.key(i):r.decide(i,stores,base,base['calibration']) for i in items}==prior
    count=0
    for i in r.rows(diagnostic=True):
        name=r.terminal_expert(i,config)
        if name:
            f=run_expert(i,name,offline=True);s=stores[i['bench']][i['id']][name]
            assert (f['pA'],f['detail'])==(s['pA'],s['detail'])
            count+=1
# Mutation proves the threshold check can fail if the gate is bypassed.
spec=importlib.util.spec_from_file_location('threshold_tests',out/'test_threshold.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
original=r.decide
with patch.object(r,'decide',side_effect=lambda i,st,c,ma,rec=None:original(i,st,{**c,'terminal_threshold':0},ma,rec)):
    result=unittest.TestResult()
    m.ThresholdTests('test_below_threshold_continues').run(result)
assert len(result.failures)==1 and not result.errors
assert not {r.key(i) for i in items}&set(config['tuning_keys'])
report=json.loads((out/'validation.json').read_text())
assert report['residual']==3
# Cross-group intervals and every historical baseline stay in validation.json.
errors=[]
for i in items:
    k=r.key(i);d=fresh[k]
    if r.score_verdict(d['verdict'],i['label'])<1:
        errors.append({'key':k,'label':i['label'],'decision':d,'terrain':r.get_signal(i,'terrain')['detail']})
r.save(out/'validation-errors.json',errors)
files=['moj/pointwise_router.py','configs/pw-router-frozen.json','configs/pw-router-v2-reference.json','configs/pw-router-v2-frozen.json','configs/pw-router-v3-frozen.json']
files += ['data/'+b+'.json' for b in (*r.BENCHES,r.DIAGNOSTIC)]
files += ['recordings/pw-'+p+'.jsonl' for p in ('jev','luna')]
files += [str(p.relative_to(r.ROOT)) for p in (r.ROOT/'results/pointwise/signals').glob('*/*.json')]
r.save(out/'verification.json',{'validation_decisions_replayed':len(fresh),'v1_decisions_unchanged':len(prior),
 'terminal_signals_rebuilt':count,'fresh_calls':0,'network_disabled':True,
 'gate_bypass_mutation_detected':True,'tuning_validation_primary_keys_disjoint':True,
 'sha256':{name:hashlib.sha256((r.ROOT/name).read_bytes()).hexdigest() for name in files}})
versions=[('v1 frozen',r.OUT/'validation.json'),('v2 supplied terminal',r.OUT/'v2/reference-only/validation.json'),('v2 plus generated terminal',r.OUT/'v2/validation.json'),('v3 tuning confidence gate',out/'validation.json')]
lines=['# Prespecified changes and ablations','','Validation is report-only. Each row adds one hypothesis; v3 is the final owner-requested freeze.','',
 '| Arm | Benchmark | Accuracy | Balanced | Sensitivity | Specificity | S2 calls/100 | Known S2 USD/100 |',
 '|---|---|---:|---:|---:|---:|---:|---:|']
for version,path in versions:
    for b,entry in json.loads(path.read_text())['benchmarks'].items():
        c=entry['rows']['MoJ']
        lines.append(f"| {version} | {b} | {100*c['accuracy']:.1f} | {100*c['balanced']:.1f} | {100*c['sensitivity']:.1f} | {100*c['specificity']:.1f} | {c['s2_per_100']:.1f} | {c['known_usd_per_100']:.6f} |")
lines += ['', 'v2 reproduces the two designer results, but unconditional supplied-reference authority regresses hard rows.',
 'v3 fits one common threshold on primary tuning data. Calibrated confidence must be at least 0.6; otherwise the reference decision enters the existing escalation and panel route.',
 'Reference-free items always begin with pw_ref_luna. Neither pw_rows nor pw_whole may judge unsupported correctness, even below the terminal threshold.',
 'The threshold improves conditional tuning mean balanced accuracy from 78.98 to 80.18 percent. Only the new expert-confidence maps are cross-fitted; inherited routing maps stay frozen.',
 'The validation result restores hard rows but loses part of both Verify gains. No validation result selects another threshold or an exception.',
 'Verify with reference stays diagnostic, outside fitting and the primary residual. Its groups differ from vanilla Verify; overlapping IDs across modes are disclosed in validation.json.']
(out/'ABLATIONS.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'replayed_decisions':len(fresh),'terminal_signals':count,'mutation_detected':True,'errors':len(errors)}))
