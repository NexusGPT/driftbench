"""Offline reproduction and honest comparison for the frozen two-step round."""
import json
from pathlib import Path
import socket
import subprocess
from unittest.mock import patch
from moj import two_step as t
from moj import pointwise_router as r

cfg=json.loads(t.CONFIG.read_text());items=t.population('valid');stores=r.load_stores(True)
saved=json.loads((t.OUT/'validation-decisions.json').read_text())
r.setup_client()
raw={row['key']:row for row in (json.loads(line) for line in (r.OUT/'recordings/jev.jsonl').read_text().splitlines()) if row.get('request')}
checks=[]
with patch.object(socket,'socket',side_effect=AssertionError('network forbidden')):
    replay={r.key(i):t.decide(i,cfg,stores) for i in items}
    assert replay==saved
    for i in t.population('tune')+items:
        for stage in ('commit','route'):
            signal=t.get(i,stage)
            if signal is None:continue
            row=raw.get(signal['usage'][0]['key'])
            if row is None:
                # Failed requests omit request bodies in client.py. Their persisted
                # missing answers are explicitly counted, never silently replayed.
                checks.append({'key':r.key(i),'stage':stage,'missing':True})
                continue
            questions={name:spec['instructions'] for name,spec in row['request']['body']['questions'].items()}
            ctx=r.Ctx(i,True)
            result=ctx.jev(r.payload(i),questions)
            assert result==signal['detail'], (r.key(i),stage)
            checks.append({'key':r.key(i),'stage':stage,'missing':all(v is None for v in result.values())})
    for i in items:
        d=saved[r.key(i)]
        if d['level']=='commit':
            # Later terrain experiments may populate the shared cache. The
            # frozen arm's path and accounted usage, not cache presence, prove
            # whether this arm invoked its router.
            assert d['path'][0]=='commit'
            assert d['usage']==t.get(i,'commit')['usage']
        else:assert d['path'][0]=='abstain' and t.get(i,'route') is not None
        if t.shape(i)=='question':assert d['level']!='commit' and 'pw_ref_luna' in d['path']
        assert not any(x in str(d['path']) for x in ('haiku','gemini','panel'))

baseline=json.loads((r.OUT/'v3/validation.json').read_text())
base_ds=json.loads((r.OUT/'v3/validation-decisions.json').read_text())
report=json.loads((t.OUT/'validation.json').read_text())
comparisons={};residual=0
for b,cell in report['cells'].items():
    its=[i for i in items if i['bench']==b]
    comparisons[b]={'single_threshold':baseline['benchmarks'][b]['rows']['MoJ'], 'two_step':cell,
        'paired_delta_vs_single':r.paired_interval(its,saved,base_ds),
        'committed':sum(saved[r.key(i)]['level']=='commit' for i in its),
        'abstained':sum(saved[r.key(i)]['level']!='commit' for i in its)}
    floor=baseline['benchmarks'][b]['noise_floor_points']
    tests=[]
    for name,c in baseline['benchmarks'][b]['rows'].items():
        if name=='MoJ' or c['n']!=len(its):continue
        difference=100*(cell['accuracy']-c['accuracy'])
        met=difference>(floor or 0)
        if b=='hardrows' and c['accuracy']==1:
            met=difference>=-(floor or 0) and cell['s2_per_100']<c['s2_per_100']
        tests.append({'baseline':name,'difference_points':difference,'met':met})
    comparisons[b]['baseline_comparisons']=tests
    if b in r.BENCHES and not all(c['met'] for c in tests):residual+=1
report.update({'comparison':comparisons,'primary_residual':residual})
r.save(t.OUT/'comparison.json',report)
base_record=subprocess.check_output(['git','show','d1317516:research/moj/results/pointwise-moj/recordings/jev.jsonl'],text=True)
old=[json.loads(line) for line in base_record.splitlines()]
now=[json.loads(line) for line in (r.OUT/'recordings/jev.jsonl').read_text().splitlines()]
new=now[len(old):];returned=[x['key'] for x in new if x.get('answer') is not None]
assert len(returned)==len(set(returned)), 'A returned answer was requested twice'
assert cfg['source_sha256']==r.hashlib.sha256(Path(t.__file__).read_bytes()).hexdigest()
r.save(t.OUT/'verification.json',{'validation_replayed':len(saved),'network_disabled':True,
 's1_stage_records':len(checks),'missing_stage_answers':sum(x['missing'] for x in checks),
 'stage_checks':checks,'new_s1_submissions':len(new),'new_s1_returned_answers':len(returned),
 'new_s2_calls':0,'system2_reserved_plus_known_usd':r.recorder(True).spend(),
 'committed_validation_items_have_no_router_call':True,'source_hash_matches':True,
 'config_sha256':r.hashlib.sha256(t.CONFIG.read_bytes()).hexdigest()})
lines=['# Two-step pointwise validation','','Both arms use the same validation entries. Percentages except calls and USD.','',
 '| Benchmark | Arm | n | Accuracy | Balanced | Sensitivity | Specificity | S2 calls/100 | Known S2 USD/100 |',
 '|---|---|---:|---:|---:|---:|---:|---:|---:|']
for b,c in comparisons.items():
    for arm,name in (('single_threshold','Frozen single threshold'),('two_step','Two-step')):
        v=c[arm]
        lines.append(f"| {b} | {name} | {v['n']} | {100*v['accuracy']:.1f} | {100*v['balanced']:.1f} | {100*v['sensitivity']:.1f} | {100*v['specificity']:.1f} | {v['s2_per_100']:.1f} | {v['known_usd_per_100']:.6f} |")
lines+=['',f'Primary residual: {residual} of 3. Reference-guided Verify remains separate from that residual.',
 'Known USD excludes System-1 pricing. The new candidate uses gpt-6-luna only; the historical single-threshold baseline retains its recorded mixed panel.',
 'Full baseline coverage, noise proxies and ceiling-tie targets follow ../v3/validation.json.']
(t.OUT/'SCOREBOARD.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'replayed':len(saved),'residual':residual,'comparisons':comparisons,'new_submissions':len(new),'new_answers':len(returned),'missing_stages':sum(x['missing'] for x in checks)},indent=2))
