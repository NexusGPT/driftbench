"""Render TEST operational state or the completed paired confirmation from disk only."""
import collections,datetime,hashlib,json,pathlib
import numpy as np
R=pathlib.Path(__file__).resolve().parent;D=R/'data'
SCRATCH=pathlib.Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad')
def rows(p):return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []
seal=json.loads((R/'test-seal.json').read_text());n=seal['count'];base=rows(D/'test-base.jsonl');calls=rows(D/'test-calls.jsonl');haiku=rows(D/'test-haiku.jsonl');refusals=rows(D/'test-refusals.jsonl')
cache={r['key']:r for r in calls};tasks=rows(D/'test-tasks.jsonl');bybase={r['id']:r for r in base}
escalated={i for i,r in bybase.items() if r.get('providerRefused') or not(len(r['games'])==2 and r['games'][0]==r['games'][1] and r['games'][0] in ('A','B'))}
pending=[t for t in tasks if t['id'] in escalated and t['key'] not in cache]
waiting=sorted({t['id'] for t in pending if t['provider']=='gemini'},key=int)
spend={'haiku':sum(r['costUsd'] for r in haiku+refusals),**{p:sum(r['usd'] for r in calls if r['provider']==p) for p in ['openai','gemini']}}
jev={k:sum(r[k] for r in calls if r['provider']=='jev') for k in ['inputTokens','outputTokens']}
dev=json.loads((D/'current-status.json').read_text());total=sum(spend.values())+dev['recordedFreshTotalUsd']
complete=len(base)==n and not pending
status={'time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'complete':complete,'expected':n,'baseItems':len(base),'escalatedItems':len(escalated),'pendingPanelPositions':len(pending),'waitingGeminiItems':waiting,'waitingGeminiCalls':sum(t['provider']=='gemini' for t in pending),'panelReceipts':dict(collections.Counter(r['provider'] for r in calls)),'haikuReceipts':len(haiku),'haikuRefusals':len(refusals),'recordedTestSpendUsd':spend,'totalRecordedDevAndTestUsd':total,'jevTokens':jev,'jevPrice':'price not published'}
(D/'test-current-status.json').write_text(json.dumps(status,indent=2)+'\n')
text=f'''# MM-Eval frozen cascade: TEST confirmation

TEST status: {'complete' if complete else 'running'}. The complete remaining eligible population contains {n:,} items, sealed before the first TEST call at commit 2154225b and pushed to research/astra-mm-replicate. Current checkpoint: {len(base):,} base decisions, {len(escalated)} escalations, {len(pending)} outstanding panel positions. Updated {status['time']}.

The fixed seed is `astra-mm-test-20261013-v1`. This is a census, so subset allocation exactly matches the remaining eligible population. Seeded ranks determine order within subsets, with proportional interleaving. Selection used no labels or outcomes. The original 950-item TEST sample, the 600-item pool sealed on research/ledger-mm at 5a357fa1, and every prior exposure in that lane's audit are excluded. There were 1,812 eligible never-scored TEST items before reserving the other lane's 600, leaving 1,212 here. ID intersections with both protected pools are empty. The seal, exclusion IDs, source hashes and request-bank hash are committed.

The candidate is exactly the frozen DEV candidate, including gpt-6-luna at low, Gemini 3.8 Flash with low thinking, and Jev's three original framings. The owner's medium setting belongs to a separate promptfoo matrix and was not used here. Gemini uses the authorized gemini-driftbench.key, a 180-second timeout, one retry and at most two concurrent calls. After the plugin-crash resume, total concurrency is at most four (previously six). No tuning or second TEST pass is permitted.

| Subset | Sealed items |
|---|---:|
'''
for g,c in seal['subsetCounts'].items():text+=f'| {g} | {c} |\n'
text+='\nThe main metric remains the equal-weight mean of the five subset means. The remaining chat and linguistics strata are small, so the larger overall item count does not guarantee a narrower macro interval than DEV.\n'
if complete:
 report=json.loads((D/'test-paired.json').read_text());a=report['completeCascadeCohort'];lo,hi=a['paired95']
 assert a['n']==n and not json.loads((D/'test-excluded.json').read_text())
 decisions=rows(D/'test-decisions.jsonl');assert len(decisions)==n
 text+=f'''\n## Full paired TEST result

Frozen base {a['base']:.2f}; cascade {a['cascade']:.2f}; paired difference {a['difference']:+.2f} percentage points, 95% interval [{lo:+.2f}, {hi:+.2f}]. Both arms include all {n:,} sealed items. Wins / losses / unchanged: {a['wins']} / {a['losses']} / {a['unchanged']}. Exact two-sided sign-test p = {a['signTestP']:.5g}. The +1.0-point gain with an interval excluding zero is {'confirmed' if a['difference']>=1 and lo>0 else 'not confirmed'} on TEST.

| Subset | n | Frozen base | Cascade | Paired difference | Paired 95% interval |
|---|---:|---:|---:|---:|---:|
'''
 for g,v in a['subsets'].items():
  delta=np.array([r['cascade']-r['base'] for r in decisions if r['group']==g]);rng=np.random.default_rng(20261013);bs=[]
  for i in range(20):bs.extend(delta[rng.integers(0,len(delta),(1000,len(delta)))].mean(axis=1)*100)
  gl,gh=np.percentile(bs,[2.5,97.5]);v['paired95']=[float(gl),float(gh)]
  text+=f"| {g} | {v['n']} | {v['base']:.2f} | {v['cascade']:.2f} | {v['difference']:+.2f} | [{gl:+.2f}, {gh:+.2f}] |\n"
 text+=f"\nHaiku agreed decisively on {n-len(escalated)} items; all {len(escalated)} escalations have full panels. Intervals use 20,000 paired bootstrap draws within subset, numpy default_rng seed 20261013, percentile endpoints 2.5 and 97.5. Subset intervals use the same seed separately.\n"
 audit=json.loads((D/'test-base-replay-audit.json').read_text());hcache={r['key']:r for r in haiku+refusals};used={v['key'] for r in audit for v in r['used']}
 assert all(not r['missing'] or r['missing'].get('recordedRefusal') for r in audit)
 basecost=sum(hcache[k]['costUsd'] for k in used);panelkeys={t['key'] for t in tasks if t['id'] in escalated};panelcost=sum(cache[k]['usd'] for k in panelkeys)
 text+=f'''\n## TEST cost per 100

| Arm | Recorded USD / 100, excluding Jev |
|---|---:|
| Frozen base | {basecost/n*100:.4f} |
| Haiku-first cascade | {(basecost+panelcost)/n*100:.4f} |
| Incremental panel cost | {panelcost/n*100:.4f} |

These inference costs count unique saved request hashes used in the final replay, including recorded provider refusals. Actual run spend below also retains every receipt if a repeated request occurred. Haiku costs come from CLI receipts. OpenAI is valued at the owner's 0.10 USD input and 0.50 USD output per million tokens (cached input 0.01); Gemini uses 0.75 input, 0.075 cached input and 3.75 output including thinking. Jev is excluded from the USD cap and cost figures.
'''
 status.update({'results':report,'baseRecordedUsdPer100':basecost/n*100,'cascadeRecordedUsdPer100':(basecost+panelcost)/n*100})
 (D/'test-current-status.json').write_text(json.dumps(status,indent=2)+'\n')
text+=f'''\n## Spend and saved state

Recorded TEST spend: Haiku {spend['haiku']:.8f} USD, OpenAI {spend['openai']:.8f} USD, Gemini {spend['gemini']:.8f} USD. Measured DEV plus TEST total: {total:.8f} USD against the 30 USD cap. DEV's three interrupted earlier Haiku calls have unknown remote completion and unreported charges, as documented below. The TEST plugin crash also left four occupied Haiku slots and two Gemini requests without completion receipts; their remote completion and charges are unknown. All saved hashes were reused, and only missing requests were retried under the owner's explicit resume instruction. No duplicate completed TEST receipt key has been observed.

TEST Jev usage: {jev['inputTokens']:,} input tokens, {jev['outputTokens']:,} output tokens, price not published. DEV Jev usage remains separately documented below.

Gemini waiting items: {', '.join(waiting) if waiting else 'none'}. Waiting Gemini call positions: {status['waitingGeminiCalls']}. Other pending panel positions: {sum(t['provider']!='gemini' for t in pending)}. Every completed response is checkpointed; successful request hashes are reused on resume. Artifacts live in `research/astra-mm/data/test*`; frozen source and prompt hashes remain unchanged.

---

'''
text+=(R/'DEV-RESULT.md').read_text()
assert '\u2013' not in text and '\u2014' not in text
(R/'RESULT.md').write_text(text);(SCRATCH/'opus/astra-mm.md').write_text(text)
print(json.dumps(status,indent=2))
