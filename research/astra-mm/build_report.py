"""Assemble the requested partial report from saved receipts and paired results only."""
import collections,datetime,hashlib,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parent;D=ROOT/'data'
SCRATCH=pathlib.Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad')
def rows(p):return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
sample=json.loads((D/'dev.json').read_text());base=rows(D/'base.jsonl');calls=rows(D/'dev-calls.jsonl');tasks=rows(D/'tasks.jsonl')
assert len(base)==len({r['id'] for r in base})==1052
assert all(hashlib.sha256(('split:mmeval:'+r['id']).encode()).digest()[0]<77 for r in sample)
report=json.loads((D/'paired-partial.json').read_text());complete=rows(D/'dev-decisions.jsonl');full=rows(D/'dev-full-panel-decisions.jsonl');excluded=json.loads((D/'dev-excluded.json').read_text())
assert not any(m['provider']!='gemini' for r in excluded for m in r.get('missing',[]))
old=json.loads((D/'checkpoint.json').read_text());initialWaiting=set(old['waitingGemini']['items'])
waiting=json.loads((D/'dev-waiting-gemini.json').read_text());newWaiting=sorted(set(waiting['items'])-initialWaiting,key=int)
assert initialWaiting<=set(waiting['items'])
assert sum(r['provider']=='gemini' for r in calls)==12
oldkeys=set(json.loads((D/'imported-haiku-keys.json').read_text()));haiku=rows(D/'haiku.jsonl');fresh=[r for r in haiku if r['key'] not in oldkeys]
spend={p:sum(r['usd'] for r in calls if r['provider']==p) for p in ['openai','gemini']};spend['haiku']=sum(r['costUsd'] for r in fresh)
counts=collections.Counter(r['provider'] for r in calls);jev={k:sum(r[k] for r in calls if r['provider']=='jev') for k in ['inputTokens','outputTokens']}
receipts={r['key']:r for r in haiku};panel={r['key']:r for r in calls};audit={r['id']:r for r in json.loads((D/'base-replay-audit.json').read_text())}
taskById=collections.defaultdict(list)
for t in tasks:taskById[t['id']].append(t)
def cohort_cost(cohort):
 ids={r['id'] for r in cohort};escalated={r['id'] for r in cohort if r['escalated']}
 hk={v['key'] for i in ids for v in audit[i]['used']};ck={t['key'] for i in escalated for t in taskById[i]}
 assert ck<=set(panel)
 b=sum(receipts[k]['costUsd'] for k in hk);add=sum(panel[k]['usd'] for k in ck)
 jt={k:sum(panel[t][k] for t in ck if panel[t]['provider']=='jev') for k in ['inputTokens','outputTokens']}
 return {'items':len(ids),'baseRecordedUsd':b,'cascadePanelRecordedUsd':add,'baseUsdPer100':b*100/len(ids),'cascadeUsdPer100':(b+add)*100/len(ids),'jevTokens':jt,'missingBaseRefusalReceipts':sum(bool(audit[i]['missing']) for i in ids)}
costs={'completeCascadeCohort':cohort_cost(complete),'fullPanelEscalationsOnly':cohort_cost(full)}
summary={'status':'base-and-non-gemini-complete','time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'baseItems':1052,'newBaseItemsThisResume':150,'frozenBaseImportedItems':795,'fullPanelItems':len(full),'completeCascadeItems':len(complete),'geminiWaiting':waiting,'original36GeminiWaiting':sorted(initialWaiting,key=int),'newGeminiWaiting':newWaiting,'successfulPanelReceipts':dict(counts),'uniquePanelRequestKeys':len(panel),'freshHaikuReceipts':len(fresh),'recordedFreshSpendUsd':spend,'recordedFreshTotalUsd':sum(spend.values()),'jevTokens':jev,'jevPrice':'price not published','cohortCosts':costs,'testCalls':0,'testGateEvaluated':False,'partialResults':report}
(D/'current-status.json').write_text(json.dumps(summary,indent=2)+'\n')
a=report['completeCascadeCohort'];f=report['fullPanelEscalationsOnly']
def interval(x):return f"{x['paired95'][0]:+.2f} to {x['paired95'][1]:+.2f}"
def table(x):
 s='| Subset | n | Frozen base | Cascade | Difference |\n|---|---:|---:|---:|---:|\n'
 for g,v in x['subsets'].items():
  if v['n']:s+=f"| {g} | {v['n']} | {v['base']:.2f} | {v['cascade']:.2f} | {v['difference']:+.2f} |\n"
  else:s+=f'| {g} | 0 | n/a | n/a | n/a |\n'
 return s
text=f'''# MM-Eval Haiku-first cascade: partial paired replication

The resumed work is complete: all 1,052 frozen-base DEV decisions and every required non-Gemini panel call are saved. Gemini remains paused. No Gemini call was made during the resume. No TEST item was scored.

## Paired result: full-panel escalations only

Only {f['n']} escalated items have every panel request recorded. On those exact paired items, the item mean is frozen base {f['base']:.2f}, cascade {f['cascade']:.2f}, difference {f['difference']:+.2f} percentage points, paired 95% interval {interval(f)}. Wins / losses / unchanged: {f['wins']} / {f['losses']} / {f['unchanged']}.

This is a partial, selected cohort with very small subset cells. The interval resamples within the represented subsets and can be degenerate when cells contain a single item. It is not the official full-DEV result. An official five-subset macro score is unavailable for this cohort if any subset is absent.

{table(f)}
Full-panel item IDs: {', '.join(r['id'] for r in full)}.

## Paired result: complete cascade decisions

The completed cascade cohort contains {a['n']} items: {a['n']-f['n']} decisive Haiku agreements, which require no panel, plus the {f['n']} full-panel escalations above. The same {len(excluded)} unfinished panels are excluded from both arms.

On this cohort, the official metric form, the unweighted mean of all five subset means, is frozen base {a['base']:.2f}, cascade {a['cascade']:.2f}, difference {a['difference']:+.2f} points, paired 95% interval {interval(a)}. Wins / losses / unchanged: {a['wins']} / {a['losses']} / {a['unchanged']}. Exact two-sided sign-test p = {a['signTestP']:.4g}.

{table(a)}
This result is labelled partial because the unresolved items are precisely items with uncertain Haiku decisions. Excluding them changes the evaluated population and does not establish whether the candidate clears the registered +1.0 gate. TEST remains closed until all 1,052 registered DEV items are evaluable.

## Pending Gemini work

Gemini has {waiting['pendingCalls']} pending call positions across {waiting['n']} items. Billing must be enabled on `~/.nexus-secrets/gemini-driftbench.key`. No alternative Gemini key is authorized. The `pause-gemini` marker remains present.

The original 36 waiting items are retained: {', '.join(sorted(initialWaiting,key=int))}.

New waiting items discovered while finishing the base: {', '.join(newWaiting) if newWaiting else 'none'}.

All waiting IDs and call positions are in `data/dev-waiting-gemini.json` and `data/dev-excluded.json`. Every non-Gemini request for these items is saved. Removing the pause marker requires the owner's billing confirmation; then the runner can call only the missing request hashes.

## Calls and cost

| Provider | Completed receipts, whole replication | Recorded new USD |
|---|---:|---:|
| Haiku | {len(fresh)} | {spend['haiku']:.8f} |
| OpenAI gpt-6-luna | {counts['openai']} | {spend['openai']:.8f} |
| Gemini 3.8 Flash | {counts['gemini']} | {spend['gemini']:.8f} |
| Total against 30 USD cap | {len(fresh)+counts['openai']+counts['gemini']} | {sum(spend.values()):.8f} |

Jev: {jev['inputTokens']:,} input tokens and {jev['outputTokens']:,} output tokens, price not published. Jev is excluded from the USD cap by owner instruction. Three calls interrupted at the earlier pause retain unknown remote completion and unreported billing status; their unrecorded order was retried under the explicit resume instruction, while their saved order was replayed.

| Evaluable cohort | n | Frozen base USD / 100 | Cascade USD / 100, excluding Jev |
|---|---:|---:|---:|
| Complete cascade decisions | {a['n']} | {costs['completeCascadeCohort']['baseUsdPer100']:.4f} | {costs['completeCascadeCohort']['cascadeUsdPer100']:.4f} |
| Full-panel escalations only | {f['n']} | {costs['fullPanelEscalationsOnly']['baseUsdPer100']:.4f} | {costs['fullPanelEscalationsOnly']['cascadeUsdPer100']:.4f} |

Cost per 100 uses the saved costs for unique prompt hashes required by that cohort, including previously recorded Haiku inference. It is separate from the new spend table. It does not estimate the full 1,052-item cascade cost while Gemini is missing. Full-panel items are the difficult routed subset, so their per-100 cost is not an expected deployment average. OpenAI and Gemini costs use observed tokens at published rates; free-tier Gemini billing may be zero. Haiku costs come from CLI receipts. Price sources: [OpenAI](https://developers.openai.com/api/docs/models/gpt-6-luna) and [Google](https://ai.google.dev/gemini-api/docs/pricing.md).

## Frozen protocol and provenance

The candidate was frozen before the first call at commit 359151f5, based on origin/research/opus-mm at 2c87e59e and council source 140f406a section 4.1. Resume started at 7e6ab851. The owner's required gpt-6-luna substitution for gpt-5.4-mini remains in force. No harm gate, pointwise arm or fitting was introduced.

Keep decisive agreement between the two frozen Haiku orders. Otherwise require two agreeing seats among the OpenAI net of both orders, Gemini net of both orders, and Jev's three-framing majority. Without that majority, the frozen base stands. The base uses native direct c576 and chat vote3. Provider refusals score zero unless a decisive panel recovers them. Correct, incorrect and tied games score 1, 0 and 0.5. Paired intervals use 20,000 bootstrap draws within subsets, numpy default_rng seed 20261013, percentile endpoints 2.5 and 97.5. The strict full-panel item mean uses observed subset-size weights; the complete cascade mean gives each subset equal weight.

The old codex-mm worktree was deleted during cleanup. Its source was restored inside this worktree from commit 0278595c. All six frozen hashes matched before calls resumed. The pinned source archive and restore script preserve that dependency. The three partial Haiku items each replayed one saved order and called the unrecorded order. The saved base is checked by offline replay, with no model call. No successful Gemini response or completed council request was repeated during this resume.

The earlier checkpoint retains two concurrent duplicate requests on identical-text orders, OpenAI item 2506 and Jev item 2605. Their receipts and cost remain included. The in-flight request guard prevents new duplicate dispatch. Replay uses the last saved response per request hash, matching the source recorder.

All 1,052 IDs are unique and satisfy the frozen DEV split. The 950 sampled TEST IDs were not used. Request and response checkpoints are committed. The branch is `research/astra-mm-replicate`; the final report is also saved as `research/astra-mm/RESULT.md`. Historical pause details remain in `PAUSED.md`.
'''
assert '\u2013' not in text and '\u2014' not in text
(SCRATCH/'opus/astra-mm.md').write_text(text);(ROOT/'RESULT.md').write_text(text)
manifest={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in D.iterdir() if p.is_file()};(ROOT/'checkpoint-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k not in ['partialResults','original36GeminiWaiting','geminiWaiting','cohortCosts']},indent=2))
