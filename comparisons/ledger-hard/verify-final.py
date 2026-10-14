"""Verify complete coverage, immutable inputs, recovery authorization, and native parity."""
import argparse, collections, datetime, subprocess
from common import *
import run
d=load_module('dialect_verification',HERE/'dialect-run.py')

def read(path):return [json.loads(s) for s in path.read_text().splitlines()] if path.exists() else []
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--require-complete',action='store_true');parser.add_argument('--require-available',action='store_true');args=parser.parse_args()
    settled=args.require_complete or args.require_available
    # Live reads span two journals. Use a common settled cutoff to avoid mixing
    # an earlier primary snapshot with later dialect dispatches.
    observation_through=None if settled else (datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=5)).isoformat()
    run.verify_seal();d.verify()
    recovery=json.loads((HERE/'crash-recovery.json').read_text())
    audit=json.loads((HERE/'construction-cue-audit.json').read_text())
    assert audit['blocking_cues']==[] and audit['verdict'].startswith('PASS')
    source_hashes={}
    for amendment in ('recovery-amendment.json','concurrency-amendment.json','quota-amendment.json','pacing-amendment.json','billing-amendment.json','topup-runtime-amendment.json','budget-amendment.json','daily-quota-amendment.json','owner-hold-amendment.json'):
        source_hashes.update(json.loads((HERE/amendment).read_text())['sha256'])
    for path,value in source_hashes.items():assert digest(ROOT/path)==value,path
    authorised={i['request_sha256']:i for i in recovery['items']}
    all_keys=set();details={};reasked=[];total=0;combined_events=[];quota_events=[];pacing_events=[]
    boundary=json.loads((HERE/'concurrency-amendment.json').read_text())['stamp']
    quota_boundary=json.loads((HERE/'quota-amendment.json').read_text())['stamp']
    pacing=json.loads((HERE/'pacing-amendment.json').read_text());pacing_boundary=pacing['stamp']
    for experiment,directory,reqs,answers in [
        ('primary',HERE,run.requests(MODELS,None),records()),
        ('dialect',HERE/'dialect',d.all_requests(),d.variant_records())]:
        unique={r['request_sha256']:r for r in reqs};by={a['request_sha256']:a for a in answers}
        assert len(by)==len(answers)
        assert set(by)<=set(unique)
        assert not set(unique)&all_keys
        all_keys.update(unique)
        starts=read(directory/'starts.jsonl');start_counts=collections.Counter(s['request_sha256'] for s in starts)
        rejections=read(directory/'billing-rejections.jsonl')
        rejection_counts=collections.Counter(a['request_sha256'] for a in rejections)
        quota_pending=read(directory/'quota-pending.jsonl')
        assert all(not a['success'] and not a.get('text') and not a.get('provider_response') and not a.get('usage') and (a.get('error') or {}).get('status')==429 for a in quota_pending)
        rejection_counts.update(a['request_sha256'] for a in quota_pending)
        assert all(not a['success'] and not a.get('text') and not a.get('provider_response') and not a.get('usage') and (a.get('error') or {}).get('status')==402 for a in rejections)
        assert set(start_counts)<=set(unique)
        for key,count in start_counts.items():
            expected=rejection_counts[key]+(2 if key in authorised and key in by else 1)
            if key not in by and rejection_counts[key]:expected=rejection_counts[key]+(1 if key in authorised else 0)
            assert count==expected,(key,count,expected)
        assert all(key in start_counts for key in by)
        commit='eeb7875e' if experiment=='primary' else 'a7954b1b'
        committed=datetime.datetime.fromisoformat(subprocess.check_output(['git','show','-s','--format=%cI',commit],cwd=ROOT,text=True).strip())
        assert all(datetime.datetime.fromisoformat(s['started'])>committed for s in starts)
        for key,a in by.items():
            assert a['started']<=a['finished']
            assert a['model']==unique[key]['model']
            if a.get('crash_reask'):
                assert key in authorised;reasked.append(key)
            if a['success']:
                expected=['claude-haiku-5-5'] if a['model']=='haiku' else a['model']
                assert a['resolved_model']==expected,a['resolved_model']
                assert a.get('usage') is not None
                decode=native.outcome if experiment=='primary' else d.outcome
                assert a['outcome']==decode(a['text'],a['side'],a['row'])
        replay=json.loads((directory/'peer-native-decoder.json').read_text())
        assert all(by[k]['outcome']==v for k,v in replay.items())
        native_expected={k for k,a in by.items() if a['success'] and a['side'].startswith('peer')}
        if settled:assert set(replay)==native_expected
        attempt_events=read(directory/'recovery-attempts.jsonl')
        active=collections.Counter();maximum=collections.Counter()
        for a in attempt_events:
            if a['event']=='backoff':assert a['seconds'] in (10,30,60,120,240);continue
            time=a['stamp'] if a['event']=='start' else a['finished']
            if observation_through and time>observation_through:continue
            assert a.get('attempt_count',a.get('attempt',1))<=6
            model=a['model']
            active[model]+=1 if a['event']=='start' else -1
            assert active[model]>=0
            maximum[model]=max(maximum[model],active[model])
            if boundary<=time<pacing_boundary:combined_events.append((time,1 if a['event']=='start' else -1))
            if time>=quota_boundary and model=='gemini-3.8-flash':quota_events.append((time,1 if a['event']=='start' else -1))
            if time>=pacing_boundary:pacing_events.append((time,1 if a['event']=='start' else -1,model))
        limits={'haiku':6,'gpt-6-luna':8,'gemini-3.8-flash':4}
        assert all(n<=limits[m] for m,n in maximum.items())
        cost=sum(run.priced(a) or 0 if a['model']=='gpt-6-luna' else a.get('measured_usd') or 0 for a in answers);total+=cost
        usage={}
        for model in sorted({a['model'] for a in answers}):
            ms=[a for a in answers if a['model']==model]
            sums=collections.Counter()
            for a in ms:
                for field,value in (a.get('usage') or {}).items():
                    if isinstance(value,(float,int)):sums[field]+=value
            usage[model]={'calls':len(ms),'planned_calls':sum(r['model']==model for r in unique.values()),'usage_totals':dict(sums),'measured_usd':sum(run.priced(a) or 0 if model=='gpt-6-luna' else a.get('measured_usd') or 0 for a in ms)}
        complete=set(by)==set(unique)
        if args.require_complete:assert complete and not any(active.values())
        if args.require_available:
            assert not any(active.values())
            assert all(unique[k]['model']=='gemini-3.8-flash' for k in set(unique)-set(by))
        assert all((a.get('error') or {}).get('status') not in (402,429) for a in answers),'Billing and quota errors must never be scored'
        details[experiment]={'complete':complete,'recorded_unique':len(by),'planned_unique':len(unique),'native_peer_decodes':len(replay),
            'recovery_max_concurrent':dict(maximum),'unanswered_started':len(set(start_counts)-set(by)),
            'billing_rejections_unscored':len(rejections),'quota_pending_unscored':len(quota_pending),'final_failed_calls':sum(not a['success'] for a in answers),'measured_usd':cost,'by_model':usage,
            'journal_sha256':digest(directory/'calls.jsonl')}
    prior=set(json.loads((HERE/'prior-census.json').read_text())['payload_sha256'])
    for row in ROWS:
        items=cases(row);labels=collections.Counter((c['kind'],c['truth']) for c in items)
        assert len(items)==384 and len(labels)==24 and set(labels.values())=={16}
        hashes={sha(payload(c,row)) for c in items};assert len(hashes)==384 and not hashes&prior
        if row=='goal':assert all(c['truth']==all(c['endState'].get(k)==v for k,v in c['expect'].items()) for c in items)
    budget=json.loads((HERE/'budget-amendment.json').read_text())
    assert total+recovery['lost_attempt_reserve_usd']<=budget['cap_usd']
    assert len(reasked)==len(set(reasked))
    if args.require_complete:assert set(reasked)==set(authorised)
    combined_active=combined_max=0
    for time,delta in sorted(combined_events):
        combined_active+=delta;combined_max=max(combined_max,combined_active)
        assert combined_active>=0
    assert combined_max<=4
    if settled:assert combined_active==0
    gemini_active=gemini_max=0
    for time,delta in sorted(quota_events):
        gemini_active+=delta;gemini_max=max(gemini_max,gemini_active)
        assert gemini_active>=0
    assert gemini_max<=2
    if settled:assert gemini_active==0
    pacing_active=collections.Counter();pacing_max=collections.Counter();pacing_total_max=0
    for time,delta,model in sorted(pacing_events):
        pacing_active[model]+=delta
        assert 0<=pacing_active[model]<=pacing['per_model_limits'][model],(model,pacing_active)
        pacing_max[model]=max(pacing_max[model],pacing_active[model])
        pacing_total_max=max(pacing_total_max,sum(pacing_active.values()))
    assert pacing_total_max<=sum(pacing['per_model_limits'].values())
    if settled:assert not any(pacing_active.values())
    available_complete=all(p['by_model'][m]['calls']==p['by_model'][m]['planned_calls'] for p in details.values() for m in ('haiku','gpt-6-luna'))
    if args.require_available:assert available_complete
    result={'verified_at':stamp(),'concurrency_observation_through':observation_through,'experiments':details,'construction_audit_sha256':digest(HERE/'construction-cue-audit.json'),
        'crash_reasked_recorded':len(reasked),'crash_reasked_keys':sorted(reasked),'crash_authorised':len(authorised),'measured_usd':total,
        'lost_attempt_reserve_usd':recovery['lost_attempt_reserve_usd'],'measured_plus_lost_reserve_usd':total+recovery['lost_attempt_reserve_usd'],'cap_usd':budget['cap_usd'],
        'complete':all(v['complete'] for v in details.values()),'available_models_complete':available_complete,'no_request_key_overlap':True,
        'combined_call_limit_from':boundary,'combined_max_concurrent_after_amendment':combined_max,
        'combined_four_call_limit_until':pacing_boundary,
        'gemini_call_limit_from':quota_boundary,'gemini_max_concurrent_after_amendment':gemini_max,
        'per_model_limit_from':pacing_boundary,'per_model_limits':pacing['per_model_limits'],
        'per_model_max_concurrent_after_pacing':dict(pacing_max),'total_max_concurrent_after_pacing':pacing_total_max}
    dump(HERE/'verification-final.json',result);print(json.dumps(result,indent=2))

if __name__=='__main__':main()
