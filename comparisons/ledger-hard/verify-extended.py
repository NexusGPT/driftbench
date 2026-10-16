"""Offline integrity and usage census for an added model cell."""
import argparse,collections
from common import *
r=load_module('verified_extended_runner',HERE/'extended-run.py')

def main(cell):
    seal=r.verify(cell);dest=HERE/cell;data=r.answers(dest);events=r.lines(dest/'attempts.jsonl')
    requested=r.requests(dest);keys={x['request_sha256'] for x in requested}
    seen=collections.Counter(x['request_sha256'] for x in data)
    starts=collections.Counter(x['request_sha256'] for x in r.lines(dest/'starts.jsonl'))
    assert all(n==1 for n in seen.values()) and set(seen)<=keys
    assert all(n==1 for n in starts.values()) and set(seen)<=set(starts)
    active=maximum=0;attempt_starts=collections.Counter();attempt_finishes=collections.Counter()
    for event in events:
        key=event['request_sha256'],event['attempt']
        if event['event']=='start':active+=1;attempt_starts[key]+=1
        elif event['event']=='finish':active-=1;attempt_finishes[key]+=1
        maximum=max(maximum,active);assert 0<=active<=seal['concurrency']
    assert active==0 and attempt_starts==attempt_finishes
    assert all(n==1 for n in attempt_starts.values())
    for answer in data:
        assert not r.cli_no_answer(answer.get('provider_response') or {})
        if answer.get('provider_response'):
            assert answer['model_match'] and answer['generated_tokens']<=4096
        if answer['success'] and cell=='sonnet-5-5' and answer.get('runtime_environment',{}).get('DISABLE_PROMPT_CACHING')=='1':
            assert answer['usage'].get('cache_creation_input_tokens',0)==0 and answer['usage'].get('cache_read_input_tokens',0)==0
    recorded_starts={x['request_sha256']:x['started'] for x in r.lines(dest/'starts.jsonl')}
    assert all(time>=seal['created'] for time in recorded_starts.values())
    tokens={}
    for experiment in ('primary','dialect'):
        for side in ('audit','peer','peer-full-state'):
            group=[x for x in data if x['experiment']==experiment and x['side']==side]
            usage={'requests':len(group),'measured_usd':sum(x.get('measured_usd') or 0 for x in group),'input':0,'cached_input':0,'cache_write_input':0,'output':0,'reasoning':0}
            for x in group:
                u=x.get('usage') or {};details=u.get('input_tokens_details') or {}
                usage['input']+=u.get('input_tokens',0)
                usage['cached_input']+=details.get('cached_tokens',u.get('cache_read_input_tokens',0))
                usage['cache_write_input']+=details.get('cache_write_tokens',u.get('cache_creation_input_tokens',0))
                usage['output']+=u.get('output_tokens',0)
                od=u.get('output_tokens_details') or {};usage['reasoning']+=od.get('reasoning_tokens',od.get('thinking_tokens',0))
            tokens[experiment+'/'+side]=usage
    measured,reserved=r.accounting(dest);assert measured+reserved<=r.cell_cap(dest)
    result={'created':stamp(),'model':seal['model'],'sealed':len(keys),'recorded':len(seen),'missing':len(keys-set(seen)),'complete':set(seen)==keys,'duplicate_answers':0,'duplicate_starts':0,'balanced_attempt_events':True,'maximum_concurrency':maximum,'no_prior_journal_changed':True,'zero_token_api_errors_counted_as_answers':0,'measured_usd':measured,'retained_reserve_usd':reserved,'cap_usd':r.cell_cap(dest),'usage_by_contestant':tokens,'lost_unique_requests':sum(x.get('item_lost',False) for x in data),'token_limited_unique_requests':sum(x.get('item_lost',False) and x.get('token_limit_lost',False) for x in data),'source_hashes':{name:digest(dest/name) for name in ['seal.json','requests.json','attempts.jsonl','starts.jsonl','primary/calls.jsonl','dialect/calls.jsonl']}}
    dump(dest/'verification.json',result);print(json.dumps({k:v for k,v in result.items() if k not in ('usage_by_contestant','source_hashes')},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('cell',choices=r.CELLS);main(p.parse_args().cell)
