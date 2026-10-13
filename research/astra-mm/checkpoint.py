"""Read-only experiment accounting, plus explicit checkpoint and report writes. Makes no model calls."""
import collections,datetime,hashlib,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parent
D=ROOT/'data'
SCRATCH=pathlib.Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad')
def rows(p):return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
sample=json.loads((D/'dev.json').read_text());ids={r['id'] for r in sample}
base=rows(D/'base.jsonl');by={r['id']:r for r in base}
calls=rows(D/'dev-calls.jsonl');cache={r['key'] for r in calls};tasks=rows(D/'tasks.jsonl')
escalated={i for i,r in by.items() if r['providerRefused'] or not(len(r['games'])==2 and r['games'][0]==r['games'][1] and r['games'][0] in ['A','B'])}
waiting={p:[t for t in tasks if t['id'] in escalated and t['provider']==p and t['key'] not in cache] for p in ['openai','gemini','jev']}
original={}
for line in (SCRATCH/'opus/rec-copy.jsonl').open():
 r=json.loads(line)
 if r.get('item') in ids:original[r['key']]=r
haiku=rows(D/'haiku.jsonl');fresh=[r for r in haiku if r['key'] not in original]
# Original receipts are retained to distinguish reused cost from new spend on resume.
(D/'imported-haiku-keys.json').write_text(json.dumps(sorted(original))+'\n')
counts=collections.Counter(r['provider'] for r in calls)
spend={p:sum(r['usd'] for r in calls if r['provider']==p) for p in ['openai','gemini']}
spend['haiku']=sum(r['costUsd'] for r in fresh)
jtoken={k:sum(r[k] for r in calls if r['provider']=='jev') for k in ['inputTokens','outputTokens']}
remaining=[r['id'] for r in sample if r['id'] not in by]
wg={'items':sorted({r['id'] for r in waiting['gemini']},key=int),'n':len({r['id'] for r in waiting['gemini']}),'pendingCalls':len(waiting['gemini'])}
(D/'dev-waiting-gemini.json').write_text(json.dumps(wg,indent=2)+'\n')
attempts=rows(D/'dev-attempts.jsonl');unresolved={}
for r in attempts:
 if r['event']=='started':unresolved[r['key']]=r
 elif r['event']=='failed':unresolved.pop(r['key'],None)
for r in calls:unresolved.pop(r['key'],None)
summary={'status':'owner-paused','time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'devItems':len(sample),'baseDecisions':len(by),'baseImported':795,'baseFreshDecisions':len(by)-795,'baseRemaining':len(remaining),'baseRemainingIds':remaining,'likelyInterruptedBaseItemIds':remaining[:3],'freshHaikuReceipts':len(fresh),'successfulCouncilCalls':dict(counts),'escalatedKnown':len(escalated),'waitingCalls':{p:len(v) for p,v in waiting.items()},'waitingGemini':wg,'recordedFreshSpendUsd':spend,'recordedFreshTotalUsd':sum(spend.values()),'jevTokens':jtoken,'jevPrice':'price not published','unresolvedCouncilAttempts':list(unresolved.values()),'testCalls':0,'baseInterruptedCallCaveat':'Three owned Haiku child processes were stopped at the explicit pause. Remote completion and any unreported charges are unknown. On resume, use saved prompt hashes and identify these partial items before retrying.'}
(D/'checkpoint.json').write_text(json.dumps(summary,indent=2)+'\n')
report=f'''# MM-Eval Haiku-first cascade replication

Paused at the owner's explicit instruction on {summary['time']}. All owned runners and their active child processes are stopped. No new model calls are authorized until the owner resumes.

Frozen configuration: commit 359151f5 on `research/astra-mm-replicate`, based on `origin/research/opus-mm` at 2c87e59e. Candidate: council commit 140f406a, section 4.1, Haiku-first cascade on the frozen base. The owner requires gpt-6-luna instead of gpt-5.4-mini; this substitution was frozen before the first call. Gemini remains gemini-3.8-flash. No other Gemini key is authorized.

## Checkpoint

| Component | Completed | Remaining |
|---|---:|---:|
| Frozen base DEV items | {len(by)} / 1,052 | {len(remaining)} |
| Reused base decisions | 795 | 0 |
| New base decisions | {len(by)-795} | {len(remaining)} |
| New Haiku call receipts | {len(fresh)} | depends on remaining items |
| gpt-6-luna escalation calls | {counts['openai']} | {len(waiting['openai'])} for known escalations |
| Gemini escalation calls | {counts['gemini']} | {len(waiting['gemini'])} for {wg['n']} known items |
| Jev escalation calls | {counts['jev']} | {len(waiting['jev'])} for known escalations |

There are {len(escalated)} known escalated items. Additional escalation requests can appear when the remaining base decisions finish. All 1,052 cohort IDs are unique and satisfy the fixed DEV split hash. No TEST inference ran and no TEST score was computed. The 950 sampled TEST IDs remain outside the candidate run.

Gemini is separately paused: `gemini-driftbench.key` hit HTTP 429 with the free-tier daily limit of 20 requests. This job saved {counts['gemini']} successful Gemini responses before the shared quota was exhausted. The owner must enable billing on that key. `gemini-old.key` and every other Gemini key are prohibited.

Items currently waiting on Gemini: {', '.join(wg['items'])}.

## Recorded spend

| Provider | New completed calls | Recorded USD |
|---|---:|---:|
| Haiku | {len(fresh)} | {spend['haiku']:.8f} |
| OpenAI gpt-6-luna | {counts['openai']} | {spend['openai']:.8f} |
| Gemini 3.8 Flash | {counts['gemini']} | {spend['gemini']:.8f} |
| Total against 30 USD cap | {len(fresh)+counts['openai']+counts['gemini']} | {sum(spend.values()):.8f} |

Jev: {jtoken['inputTokens']:,} input tokens and {jtoken['outputTokens']:,} output tokens, price not published. Jev is excluded from the USD cap by the owner's instruction. OpenAI and Gemini USD values use observed tokens and current published paid-tier rates; Gemini's free-tier responses might actually bill zero. Haiku USD comes from CLI receipts. Token price sources: [OpenAI](https://developers.openai.com/api/docs/models/gpt-6-luna) and [Google](https://ai.google.dev/gemini-api/docs/pricing.md).

Three active Haiku child processes were terminated at the explicit pause. Their remote completion and any charges not returned in a receipt are unknown. The first three incomplete items in dispatch order are {', '.join(remaining[:3])}; inspect their cached prompt hashes before retrying. There are {len(unresolved)} unresolved council attempts. Completed request hashes must never be called again.

## Resume

1. Wait for explicit owner resume. Retain the six-call total concurrency limit and 30 USD cap.
2. Read `research/astra-mm/data/checkpoint.json`, `pause-state.json` and the saved receipts. Do not rerun a completed prompt. Audit the partial Haiku items before dispatch.
3. Resume the existing base with `research/opus-mm/frozen-arm.mts`, the saved `base.jsonl` and `haiku.jsonl`. Use the local `research/astra-mm/tsconfig.json`, and set TMPDIR inside this worktree. Three base workers plus three council workers allow six model calls total because base orders run sequentially.
4. Resume `python3 research/astra-mm/run_cascade.py dev 3`. The `pause-gemini` marker blocks that seat while OpenAI and Jev run. Remove that marker only after the owner confirms billing is enabled on the authorized Gemini key. The complete request bank is saved locally as `data/tasks.jsonl`; it is deterministically generated by `prepare.mts` and its SHA-256 is recorded in the checkpoint manifest.
5. Once all 1,052 base decisions and all required escalation calls exist, run `decisions.mts`, then compute the paired macro difference and interval. The statistical report is still to be implemented. Report all five subset means and full deployment cost per 100, including reused base inference cost separately from new cash spend.
6. TEST remains unopened unless DEV gains at least 1.0 point and the paired 95% interval lower endpoint exceeds zero. If that gate passes, run exactly one pass on unsampled TEST items only, excluding all 950 sampled IDs.

## Frozen analysis

The frozen base uses native direct comparisons and chat vote3. Keep two equal decisive Haiku orders. Otherwise require two agreeing seats among gpt-6-luna, Gemini and Jev's original three-framing majority. Without that majority, Haiku stands. No harm gate, pointwise arm or fitting. Provider refusals score zero in the base; a decisive cascade can recover them. Item score averages the two game scores, with correct 1, incorrect 0, tie 0.5. Overall score gives equal weight to the five subset means. Use 20,000 paired bootstrap draws within subsets, numpy default_rng seed 20261013, percentile 2.5 and 97.5.

No replication gain, interval, per-subset result or cost-per-100 claim is available yet. Incomplete cohorts have not been scored. The original DEV400 result was 91.16 versus 89.65 and selected the candidate; it is not the replication result.
'''
(SCRATCH/'opus/astra-mm.md').write_text(report)
(ROOT/'PAUSED.md').write_text(report)
manifest={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in D.iterdir() if p.is_file()}
(ROOT/'checkpoint-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k not in ['baseRemainingIds','waitingGemini']},indent=2))
