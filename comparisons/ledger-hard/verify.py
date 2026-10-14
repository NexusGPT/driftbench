"""Read-only proof of the seal, labels, native parity, chronology and paid journal."""
import collections, datetime, json, subprocess
from common import *
from run import requests, verify_seal, priced

def main():
    seal=verify_seal(); calls=records()
    starts=[json.loads(s) for s in (HERE/'starts.jsonl').read_text().splitlines()]
    by_key={c['request_sha256']:c for c in calls}
    raw_calls=[json.loads(s) for s in (HERE/'calls.jsonl').read_text().splitlines()]
    raw_by_key={c['request_sha256']:c for c in raw_calls}
    assert len(by_key)==len(calls), 'Duplicate paid answer key'
    assert len({s['request_sha256'] for s in starts})==len(starts), 'Duplicate dispatch key'
    planned={r['request_sha256']:r for r in requests(MODELS,None)}
    assert set(by_key)<=set(planned)
    assert {s['request_sha256'] for s in starts}<=set(planned)
    events=[]
    first=None
    for s in starts:
        events.append((s['started'],1))
        if first is None or s['started']<first:first=s['started']
    for c in calls:
        assert c['started']<=c['finished']
        events.append((raw_by_key[c['request_sha256']]['finished'],-1))
        if c['success']:
            assert c['resolved_model']==(['claude-haiku-5-5'] if c['model']=='haiku' else 'gpt-6-luna'),c['resolved_model']
            assert c['outcome']==native.outcome(c['text'],c['side'],c['row'])
            assert priced(c) is not None
    active=maximum=0
    for t,delta in sorted(events):
        active+=delta; maximum=max(maximum,active)
    assert maximum<=seal['concurrency'],maximum
    attempts_path=HERE/'transport-attempts.jsonl'
    attempts=[json.loads(s) for s in attempts_path.read_text().splitlines()] if attempts_path.exists() else []
    http_active=http_max=0
    for event in attempts:
        if event['event']=='start':http_active+=1
        elif event['event']=='finish':http_active-=1
        http_max=max(http_max,http_active)
        assert event['attempt']<=3
    assert http_max<=2,http_max
    committed_at=subprocess.check_output(['git','show','-s','--format=%cI','eeb7875e'],cwd=ROOT,text=True).strip()
    if first:assert datetime.datetime.fromisoformat(first)>datetime.datetime.fromisoformat(committed_at)
    budget=sum(priced(c) if priced(c) is not None else c['cap_accounted_usd'] for c in calls)
    assert budget<=10,budget
    prior=set(json.loads((HERE/'prior-census.json').read_text())['payload_sha256'])
    for row in ROWS:
        rows=cases(row)
        assert len(rows)==384 and sum(c['truth'] for c in rows)==192
        counts=collections.Counter((c['kind'],c['truth']) for c in rows)
        assert len(counts)==24 and set(counts.values())=={16}
        hashes={sha(payload(c,row)) for c in rows}
        assert len(hashes)==384 and not hashes&prior
        for c in rows:
            if row=='goal':assert c['truth']==all(c['endState'].get(k)==v for k,v in c['expect'].items())
    parity=json.loads((HERE/'peer-native-decoder.json').read_text()) if (HERE/'peer-native-decoder.json').exists() else {}
    assert all(by_key[k]['outcome']==v for k,v in parity.items())
    result={'verified_at':stamp(),'seal_commit':'eeb7875e','seal_committed_at':committed_at,'first_dispatch':first,
            'completed_calls':len(calls),'planned_unique_calls':len(planned),'inflight':len(starts)-len(calls),
            'all_primary_complete':len(calls)==len(planned),'max_concurrent':maximum,'luna_http_max_after_amendment':http_max,'cap_accounted_usd':budget,
            'native_peer_answers_checked':len(parity),'successful':sum(c['success'] for c in calls),
            'seal_sha256':digest(HERE/'seal.json'),'accounting_amendment_sha256':digest(HERE/'accounting-amendment.json')}
    dump(HERE/'verification.json',result)
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
