"""Append a fee-only correction from recorded usage; never change answers or make calls."""
import datetime,json,sys
from pathlib import Path
BASE=Path(__file__).resolve().parent
sys.path.insert(0,str(BASE));from budget import transact
path=BASE/'evidence/luna-cache-write-reconciliation.json'
if path.exists():
 print(path.read_text());raise SystemExit(0)
rows=[json.loads(x) for x in (BASE/'receipts/calls.jsonl').read_text().splitlines()]
corrections=[]
for r in rows:
 if r['model']!='gpt-6-luna':continue
 u=(r.get('metadata') or {}).get('usage')
 if not u:continue
 details=u.get('prompt_tokens_details') or {};cached=details.get('cached_tokens',0);written=details.get('cache_write_tokens',0)
 inp=u['prompt_tokens'];out=u['completion_tokens'];assert inp<272000
 prior=((inp-cached)*.10+cached*.01+out*.50)/1e6
 assert abs(prior-r['costUsd'])<1e-9, r['id']
 if written:corrections.append(dict(receipt=r['id'],phase=r.get('phase','unassigned'),fingerprint=r['fingerprint'],cacheWriteTokens=written,additionalUsd=written*.025/1e6))
amount=sum(r['additionalUsd'] for r in corrections);stamp=datetime.datetime.now(datetime.timezone.utc).isoformat();token='fee-only-luna-cache-write-20261013'
assert not any(r['id']==token for r in rows)
transact(BASE/'receipts/budget.json','reserve',token,amount,'gpt-6-luna')
state=transact(BASE/'receipts/budget.json','settle',token,amount,'gpt-6-luna')
receipt=dict(id=token,at=stamp,model='gpt-6-luna',phase='fee-reconciliation',fingerprint='not-a-model-request',costUsd=amount,text='',status='fee-adjustment',state=state,metadata={'noProviderCall':True,'source':'evidence/luna-cache-write-reconciliation.json'})
with (BASE/'receipts/calls.jsonl').open('a') as f:f.write(json.dumps(receipt)+'\n')
evidence=dict(at=stamp,source='https://developers.openai.com/api/docs/pricing',usageSource='https://developers.openai.com/api/docs/guides/prompt-caching',publishedInputPerMillionUsd=.1,publishedWritePerMillionUsd=.125,feeAdjustmentUsd=amount,cacheWriteTokens=sum(r['cacheWriteTokens'] for r in corrections),corrections=corrections,providerCalls=0,answersChanged=0,priorReceiptsPreserved=True,syntheticFeeReceiptId=token)
path.write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps({k:v for k,v in evidence.items() if k!='corrections'}))
