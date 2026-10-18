"""Reconcile recordings, fees and validation. This program never calls a provider."""
import collections
import datetime
import fcntl
import hashlib
import json
from pathlib import Path
import subprocess
import sys

BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[2]
MODELS=['gemini-3.5-flash-lite']
PHASES=['pilot','validity','noise-0','noise-1','noise-2','results']

def rows(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []
def main():
    from stats import main as score, compare
    from validate import calculate
    score()
    validation={m:calculate(m) for m in MODELS}
    cells=json.loads((BASE/'evidence/cells.json').read_text())
    limit_report=json.loads((BASE/'evidence/output-limit-errors.json').read_text())
    pool=json.loads((BASE/'evidence/pool.json').read_text())
    audit=json.loads((BASE/'evidence/audit-map.json').read_text())
    runtime=json.loads((BASE/'evidence/runtime-freeze.json').read_text())
    with (BASE/'receipts/budget.json').open() as f:
        fcntl.flock(f,fcntl.LOCK_SH);budget=json.load(f)
    calls=rows(BASE/'receipts/calls.jsonl')
    by_id={r['id']:r for r in calls}
    assert len(by_id)==len(calls),'Duplicate provider receipt id'
    ledger={r['id']:r for r in budget['receipts']}
    assert set(by_id)==set(ledger),'Receipt and atomic budget ids disagree'
    assert all(abs(r['costUsd']-ledger[r['id']]['usd'])<1e-10 for r in calls)
    assert abs(sum(r['costUsd'] for r in calls)-budget['spentUsd'])<1e-8
    attribution=json.loads((BASE/'evidence/request-attribution.json').read_text())['rows']
    keys_by_fingerprint={}
    for r in attribution:
        keys_by_fingerprint.setdefault((r['model'],r['phase'],r['fingerprint']),set()).add(r['key'])
    failed_costs={}
    for r in calls:
        if r.get('status')=='transport-failure':
            for key in keys_by_fingerprint.get((r['model'],r['phase'],r.get('fingerprint')),set()):
                failed_costs[(r['model'],r['phase'],key)]=r['costUsd']
    reserved=sum(r['usd'] for r in budget['reservations'].values())
    phases={}
    for model in MODELS:
        phases[model]={}
        for phase in PHASES:
            path=BASE/phase/f'{model}.json'
            if not path.exists():
                phases[model][phase]={'status':'pending'};continue
            report=json.loads(path.read_text())
            cassette_phase='test' if phase=='results' else phase
            namespace=runtime['pilotRecordingsId'] if phase=='pilot' else runtime.get('recordingsId',runtime['id'])
            recording=BASE/'recordings'/namespace/cassette_phase/'longjudge-verify'/f'{model}.jsonl'
            recordings=rows(recording)
            # A duplicate key can carry two actually billed concurrent calls. Keep both costs visible.
            unique={r['key']:r for r in recordings}
            def unique_fee(r):
                return failed_costs.get((model,cassette_phase,r['key']),r['costUsd']) if 'failure' in r else r['costUsd']
            phases[model][phase]=dict(items=report['items'],stopped=report.get('stopped'),
                missing={c['contestant']:sum(d.get('missing',0)>0 or type(d.get('pass')) is not bool for d in c['decisions']) for c in report['contestants']},
                cassetteRows=len(recordings),uniquePromptKeys=len(unique),
                terminalNoAnswerRecords=sum('failure' in r for r in recordings),
                recordedExecutionUsd=sum(r['costUsd'] for r in recordings),
                costPer100UniqueKeys={c:sum(unique_fee(r) for r in unique.values() if r['contestant']==c)*100/report['items'] for c in ['driftbench-verify-uncertainty-cascade','promptfoo']},
                report=str(path.relative_to(ROOT)),recording=str(recording.relative_to(ROOT)))
    for cell in cells['cells']:
        cell['outputLimitErrors']=limit_report['counts'][cell['model']]
        cell['validation']=validation[cell['model']]
        cell['phaseCoverage']=phases[cell['model']]
        if cell['status']=='measured':
            original=json.loads((BASE/'results'/f"{cell['model']}.json").read_text())
            strict=json.loads((BASE/'results'/f"{cell['model']}.strict.json").read_text())
            cell['productFinal']={label:cell[label] for label in ['official','audited']}
            a,b=[c['decisions'] for c in strict['contestants']]
            cell['official']=compare(pool,a,b,{})
            cell['audited']=compare(pool,a,b,audit)
            for variant in [cell,cell['productFinal']]:
                for label in ['official','audited']:
                    variant[label]['validVerdictCoverageComplete']=not variant[label]['provisional']
                    # A measured output-limit error is an endpoint outcome, not an unattempted item.
                    variant[label]['provisional']=bool(original.get('stopped'))
            cell['headline']='strict'
            cell['strictDecisions']=f"results/{cell['model']}.strict.json"
            cell['productFinalDecisions']=f"results/{cell['model']}.json"
            cell['costPer100UniqueKeys']=phases[cell['model']]['results']['costPer100UniqueKeys']
            cell['validityPassed']=bool(cell['validation']['mutationChecks']) and all(c['pass_'] for c in cell['validation']['mutationChecks'].values())
            if cell['official']['provisional'] or not cell['validityPassed']:
                cell['claimStatus']='INCOMPLETE_OR_INVALID; no confirmatory win claim'
            else:cell['claimStatus']='Pending prespecified 18-cell Holm correction'
    cells['noiseFloor']={m:v['noise'] for m,v in validation.items()}
    cells['outputLimitErrors']=limit_report
    cells['cheaters']['alwaysFailAudited']=1-cells['cheaters']['alwaysPassAudited']
    cells['fees']=dict(settledUsd=budget['spentUsd'],unresolvedMaximumUsd=reserved,
        maximumAccountedUsd=budget['spentUsd']+reserved,capUsd=budget['capUsd'],providerReceipts=len(calls),
        byModel={m:sum(r['costUsd'] for r in calls if r['model']==m) for m in MODELS},
        unknownCharges=budget['reservations'],source='receipts/budget.json and receipts/calls.jsonl')
    cells['freeze']={'runtime':runtime['id'],'core':runtime['coreSha'],
        'hashes':{name:hashlib.sha256((BASE/name).read_bytes()).hexdigest() for name in ['evidence/seal.json','evidence/runtime-freeze.json','evidence/pilot-runtime-freeze.json','evidence/scoring-freeze.json','evidence/pool.json','evidence/audit-map.json','stats.py','validate.py','run.ts','transport.ts','summarize.py','output_limits.py','trace-requests.ts']}}
    cells['at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    (BASE/'evidence/cells.json').write_text(json.dumps(cells,indent=2)+'\n')
    print(json.dumps({'fees':cells['fees'],'states':{m:phases[m] for m in MODELS}},indent=2))
if __name__=='__main__':main()
