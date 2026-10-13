"""Verify complete coverage, immutable inputs, recovery authorization, and native parity."""
import argparse, collections, datetime, subprocess
from common import *
import run
d=load_module('dialect_verification',HERE/'dialect-run.py')

def read(path):return [json.loads(s) for s in path.read_text().splitlines()] if path.exists() else []
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--require-complete',action='store_true');args=parser.parse_args()
    run.verify_seal();d.verify()
    recovery=json.loads((HERE/'crash-recovery.json').read_text())
    audit=json.loads((HERE/'construction-cue-audit.json').read_text())
    assert audit['blocking_cues']==[] and audit['verdict'].startswith('PASS')
    source_hashes={}
    for amendment in ('recovery-amendment.json','concurrency-amendment.json'):
        source_hashes.update(json.loads((HERE/amendment).read_text())['sha256'])
    for path,value in source_hashes.items():assert digest(ROOT/path)==value,path
    authorised={i['request_sha256']:i for i in recovery['items']}
    all_keys=set();details={};reasked=[];total=0;combined_events=[]
    boundary=json.loads((HERE/'concurrency-amendment.json').read_text())['stamp']
    for experiment,directory,reqs,answers in [
        ('primary',HERE,run.requests(MODELS,None),records()),
        ('dialect',HERE/'dialect',d.all_requests(),d.variant_records())]:
        unique={r['request_sha256']:r for r in reqs};by={a['request_sha256']:a for a in answers}
        assert len(by)==len(answers)
        assert set(by)<=set(unique)
        assert not set(unique)&all_keys
        all_keys.update(unique)
        starts=read(directory/'starts.jsonl');start_counts=collections.Counter(s['request_sha256'] for s in starts)
        assert set(start_counts)<=set(unique)
        for key,count in start_counts.items():
            assert count==(2 if key in authorised and key in by else 1),(key,count)
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
        if args.require_complete:assert set(replay)==native_expected
        attempt_events=read(directory/'recovery-attempts.jsonl')
        active=collections.Counter();maximum=collections.Counter()
        for a in attempt_events:
            if a['event']=='backoff':assert a['seconds'] in (10,30);continue
            assert a.get('attempt_count',a.get('attempt',1))<=3
            model=a['model']
            active[model]+=1 if a['event']=='start' else -1
            assert active[model]>=0
            maximum[model]=max(maximum[model],active[model])
            time=a['stamp'] if a['event']=='start' else a['finished']
            if time>=boundary:combined_events.append((time,1 if a['event']=='start' else -1))
        limits={'haiku':6,'gpt-6-luna':2 if experiment=='primary' else 4,'gemini-3.8-flash':4}
        assert all(n<=limits[m] for m,n in maximum.items())
        cost=sum(run.priced(a) or 0 if a['model']=='gpt-6-luna' else a.get('measured_usd') or 0 for a in answers);total+=cost
        usage={}
        for model in sorted({a['model'] for a in answers}):
            ms=[a for a in answers if a['model']==model]
            sums=collections.Counter()
            for a in ms:
                for field,value in (a.get('usage') or {}).items():
                    if isinstance(value,(float,int)):sums[field]+=value
            usage[model]={'calls':len(ms),'usage_totals':dict(sums),'measured_usd':sum(run.priced(a) or 0 if model=='gpt-6-luna' else a.get('measured_usd') or 0 for a in ms)}
        complete=set(by)==set(unique)
        if args.require_complete:assert complete and not any(active.values())
        details[experiment]={'complete':complete,'recorded_unique':len(by),'planned_unique':len(unique),'native_peer_decodes':len(replay),
            'recovery_max_concurrent':dict(maximum),'unanswered_started':len(set(start_counts)-set(by)),
            'final_failed_calls':sum(not a['success'] for a in answers),'measured_usd':cost,'by_model':usage,
            'journal_sha256':digest(directory/'calls.jsonl')}
    prior=set(json.loads((HERE/'prior-census.json').read_text())['payload_sha256'])
    for row in ROWS:
        items=cases(row);labels=collections.Counter((c['kind'],c['truth']) for c in items)
        assert len(items)==384 and len(labels)==24 and set(labels.values())=={16}
        hashes={sha(payload(c,row)) for c in items};assert len(hashes)==384 and not hashes&prior
        if row=='goal':assert all(c['truth']==all(c['endState'].get(k)==v for k,v in c['expect'].items()) for c in items)
    assert total+recovery['lost_attempt_reserve_usd']<=10
    assert len(reasked)==len(set(reasked))
    if args.require_complete:assert set(reasked)==set(authorised)
    combined_active=combined_max=0
    for time,delta in sorted(combined_events):
        combined_active+=delta;combined_max=max(combined_max,combined_active)
        assert combined_active>=0
    assert combined_max<=4
    if args.require_complete:assert combined_active==0
    result={'verified_at':stamp(),'experiments':details,'construction_audit_sha256':digest(HERE/'construction-cue-audit.json'),
        'crash_reasked_recorded':len(reasked),'crash_authorised':len(authorised),'measured_usd':total,
        'lost_attempt_reserve_usd':recovery['lost_attempt_reserve_usd'],'measured_plus_lost_reserve_usd':total+recovery['lost_attempt_reserve_usd'],
        'complete':all(v['complete'] for v in details.values()),'no_request_key_overlap':True,
        'combined_call_limit_from':boundary,'combined_max_concurrent_after_amendment':combined_max}
    dump(HERE/'verification-final.json',result);print(json.dumps(result,indent=2))

if __name__=='__main__':main()
