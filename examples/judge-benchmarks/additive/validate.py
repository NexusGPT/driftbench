"""Independent consistency checks on saved DEV evidence. No model calls or dataset loading."""
import json, re, hashlib, datetime
from pathlib import Path
from collections import Counter
H=Path(__file__).resolve().parent
def read(name):return json.loads((H/name).read_text())
scores=read('scores-dev.json');items=read('verify-dev-items.json');ids={r['id'] for r in items}
assert len(ids)==95 and all(hashlib.sha256(f'split:longjudge-verify:{i}'.encode()).digest()[0]<77 for i in ids)
base={r['id']:r['pass'] for r in read('driftbench-verify-uncertainty-cascade.json')['contestants'][0]['decisions']}
labels={r['id']:r['correct'] for r in items};aud={**labels,**{r['id']:r['audited'] for r in read('label-audit.json')}}
for r in scores['verify']:
 d=r['decisions'];assert set(d)==ids
 assert sum(d[i]==labels[i] for i in ids)==r['official']
 assert sum(d[i]==aud[i] for i in ids)==r['audited']
 assert r['audited']==89+len(r['fixes'])-len(r['breaks'])
 assert sum(r['decidedBy'].values())==95
 for i in ids:
  if d[i] is True and base[i] is False:assert i.startswith('97420293')
 assert r['barMet']==(r['audited']>=90 and not r['newFalseRejections'])
flags=re.I|re.A
strip=re.compile(r"\b(?:not to add|do not add|don't add|not to invent|do not invent|don't invent)[^\n.]{0,160}\b(?:request|requirement|detail)s?[^\n.]{0,80}",flags)
trigger=re.compile(r'unstated|not (?:given|specified|stated)|\bassum(?:e|ed|ing|ption)\b|\bintended\b',flags)
gates=read('cascade-gates-dev.json')
assert gates['matched']==95 and gates['newCalls']==0
for r in gates['rows']:
 gate=r['initial'].get('pass') is True and any(trigger.search(strip.sub('',t)) for t in r['texts'])
 assert gate==r['uncertainty'] and r['pass']==base[r['id']]
for r in scores['writing']:
 rows=r['rows']; assert len(rows)==90 and len({x['rowKey'] for x in rows})==90
 assert all(hashlib.sha256(f"split:longjudge-wp:{x['id']}".encode()).digest()[0]<77 for x in rows)
 assert sum(v==x['label'] for x in rows for v in x['games'])==r['official']
 assert r['official']==116+len(r['fixes'])-len(r['breaks'])
 assert sum(r['decidedBy'].values())==180
 assert all(x['games']==x['baseline'] for x in rows if not x['routed'])
 assert r['subsetDesignCorrect']-r['subsetBaselineCorrect']==r['netGames']
 assert r['netGames']==len(r['fixes'])-len(r['breaks'])
receipts=[json.loads(l) for l in (H/'cross-family-receipts.jsonl').read_text().splitlines()]
assert len(receipts)==10 and Counter(r['provider'] for r in receipts)=={'openai':5,'jev':5}
assert {r['id'] for r in receipts}==set(scores['routing']['R'])
assert all(len(r['attempts'])==1 and r['attempts'][0]['status']==200 for r in receipts)
events=[]
for r in receipts:
 start=datetime.datetime.fromisoformat(r['startedAt']).timestamp();end=start+r['elapsedSeconds']
 assert start<datetime.datetime.fromisoformat('2026-10-13T04:35:00+00:00').timestamp()
 events.extend([(start,1),(end,-1)])
active=maximum=0
for _,delta in sorted(events):active+=delta;maximum=max(maximum,active)
assert maximum<=6
for r in read('cross-family-dev.json')['rows']:
 assert r['confirmed']==(r['calls']['openai']['parsed'].get('pass') is False and r['calls']['jev']['probabilityIncorrect']>=0.6)
assert [r['name'] for r in scores['verify'] if r['barMet']]==['cascade+M4']
assert not any(r['barMet'] for r in scores['writing'])
result={'status':'pass','verifyItems':95,'writingPairs':90,'verifyDesigns':len(scores['verify']),'writingDesigns':len(scores['writing']),'frozenReplayMatches':95,'gateReproductions':95,'freshCalls':10,'maxObservedConcurrency':maximum,'lastCallStartedUtc':max(r['startedAt'] for r in receipts),'lastCallFinishedUtc':datetime.datetime.fromtimestamp(max(datetime.datetime.fromisoformat(r['startedAt']).timestamp()+r['elapsedSeconds'] for r in receipts),datetime.timezone.utc).isoformat(),'testItemsSelected':0}
(H/'validation-dev.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
