"""Report the full frozen DEV comparison from complete checkpoints, without further model calls."""
import collections,datetime,hashlib,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parent;D=ROOT/'data'
SCRATCH=pathlib.Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad')
def rows(p):return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
sample=json.loads((D/'dev.json').read_text());base=rows(D/'base.jsonl');decisions=rows(D/'dev-decisions.jsonl');calls=rows(D/'dev-calls.jsonl');tasks=rows(D/'tasks.jsonl')
assert len(base)==len({r['id'] for r in base})==len(decisions)==1052
assert not json.loads((D/'dev-excluded.json').read_text())
assert all(hashlib.sha256(('split:mmeval:'+r['id']).encode()).digest()[0]<77 for r in sample)
report=json.loads((D/'paired-full.json').read_text());a=report['completeCascadeCohort'];old=json.loads((D/'checkpoint.json').read_text())
oldkeys=set(json.loads((D/'imported-haiku-keys.json').read_text()));haiku=rows(D/'haiku.jsonl');fresh=[r for r in haiku if r['key'] not in oldkeys];hcache={r['key']:r for r in haiku};pcache={r['key']:r for r in calls}
spend={p:sum(r['usd'] for r in calls if r['provider']==p) for p in ['openai','gemini']};spend['haiku']=sum(r['costUsd'] for r in fresh)
counts=collections.Counter(r['provider'] for r in calls);jev={k:sum(r[k] for r in calls if r['provider']=='jev') for k in ['inputTokens','outputTokens']}
audit=json.loads((D/'base-replay-audit.json').read_text());used={v['key'] for r in audit for v in r['used']};basecost=sum(hcache[k]['costUsd'] for k in used)
escalated={r['id'] for r in decisions if r['escalated']};panelkeys={t['key'] for t in tasks if t['id'] in escalated};assert panelkeys<=set(pcache)
panelcost=sum(pcache[k]['usd'] for k in panelkeys);refused=sum(r['providerRefused'] for r in audit);missingReceipts=sum(bool(r['missing']) for r in audit)
byid={r['id']:r for r in decisions};recovered=[r['id'] for r in decisions if r['baseRefused'] and r['cascade']>0]
summary={'status':'full-dev-complete','time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'baseItems':1052,'panelItems':len(escalated),'waitingGeminiItems':0,'waitingGeminiCalls':0,'successfulPanelReceipts':dict(counts),'uniquePanelRequestKeys':len(pcache),'freshHaikuReceipts':len(fresh),'recordedFreshSpendUsd':spend,'recordedFreshTotalUsd':sum(spend.values()),'jevTokens':jev,'jevPrice':'price not published','baseRecordedInferenceUsd':basecost,'panelRecordedInferenceUsd':panelcost,'baseRecordedUsdPer100':basecost/10.52,'cascadeRecordedUsdPer100':(basecost+panelcost)/10.52,'missingBaseRefusalReceipts':missingReceipts,'baseProviderRefusals':refused,'providerRefusalRecoveries':recovered,'results':report,'testCalls':0}
(D/'current-status.json').write_text(json.dumps(summary,indent=2)+'\n')
def table(x):
 s='| Subset | n | Frozen base | Cascade | Paired difference |\n|---|---:|---:|---:|---:|\n'
 for g,v in x['subsets'].items():s+=f"| {g} | {v['n']} | {v['base']:.2f} | {v['cascade']:.2f} | {v['difference']:+.2f} |\n"
 return s
lo,hi=a['paired95'];gate=report['testGatePassed'];costnote=f'{missingReceipts} provider-refusal calls lack receipts, so these are observed-cost lower bounds' if missingReceipts else 'all required successful base receipt costs are included'
text=f'''# MM-Eval Haiku-first cascade: full DEV replication

All 1,052 registered DEV items are complete. The frozen base scores {a['base']:.2f}; the cascade scores {a['cascade']:.2f}. The paired gain is {a['difference']:+.2f} percentage points, with a 95% interval of {lo:+.2f} to {hi:+.2f}. The registered +1.0-point gate with an interval excluding zero is {'met' if gate else 'not met'}.

## Full paired result

The metric is the unweighted mean of the five subset means. Both arms use the same 1,052 items. No missing panel was imputed, and no item was excluded. Wins / losses / unchanged: {a['wins']} / {a['losses']} / {a['unchanged']}. Exact two-sided sign-test p = {a['signTestP']:.5g}.

{table(a)}
Haiku agreed decisively on {1052-len(escalated)} items. All {len(escalated)} escalated items now have complete OpenAI, Gemini and Jev panels. The base had {refused} provider refusals, scored zero; the cascade recovered positive credit on {len(recovered)} of them ({', '.join(recovered) if recovered else 'none'}).

The original DEV400 selection score was 91.16 versus 89.65, a gain of +1.51. That was the selection result with gpt-5.4-mini. This independent DEV remainder uses the owner's required gpt-6-luna substitution, frozen before its first call. It is not an exact same-model replication of DEV400.

## Cost per 100

| Arm | Recorded inference USD / 100 items, excluding Jev |
|---|---:|
| Frozen base | {basecost/10.52:.4f} |
| Haiku-first cascade | {(basecost+panelcost)/10.52:.4f} |
| Incremental panel cost | {panelcost/10.52:.4f} |

These figures include previously recorded Haiku inference and the unique saved request hashes used by the final replay. They describe recorded inference cost, separate from new spend. Limitation: {costnote}. Three Haiku calls interrupted at the earlier owner pause also have unknown remote completion and unreported charges. Gemini's initial free-tier calls may have billed zero; the table values their observed tokens at paid-tier rates.

| Provider | New completed receipts across this replication | Recorded new USD |
|---|---:|---:|
| Haiku | {len(fresh)} | {spend['haiku']:.8f} |
| OpenAI gpt-6-luna | {counts['openai']} | {spend['openai']:.8f} |
| Gemini 3.8 Flash | {counts['gemini']} | {spend['gemini']:.8f} |
| Total against the 30 USD cap | {len(fresh)+counts['openai']+counts['gemini']} | {sum(spend.values()):.8f} |

Jev: {jev['inputTokens']:,} input tokens and {jev['outputTokens']:,} output tokens, price not published. Jev is excluded from the USD cap by owner instruction. OpenAI and Gemini costs use observed tokens at published rates; Haiku costs come from CLI receipts. Price sources: [OpenAI](https://developers.openai.com/api/docs/models/gpt-6-luna) and [Google](https://ai.google.dev/gemini-api/docs/pricing.md).

## Gemini completion and checkpoints

After billing confirmation, Gemini ran only with `~/.nexus-secrets/gemini-driftbench.key`, at two calls in flight, a 180-second timeout and one permitted retry per failed request. The original 68 missing call positions on 36 items were retained. Finishing the last 150 base decisions added items 2507 and 3240, bringing the billing-resume queue to 72 positions on 38 items. Shared identical request hashes reuse a saved result. The final waiting list is empty. No other Gemini key was used.

Every successful response was saved before a derived verdict. The earlier checkpoint contains two concurrent duplicate requests on identical-text orders, OpenAI item 2506 and Jev item 2605. Both receipts and charges remain included in new spend. An in-flight key guard prevents further duplicate dispatch; replay uses the last saved response per hash, matching the source recorder. All later completed hashes were reused.

## Frozen protocol and verification

Configuration was frozen at commit 359151f5 before the first call, based on origin/research/opus-mm at 2c87e59e and council commit 140f406a section 4.1. Resume began at 7e6ab851. The base is native direct c576, with per-order chat vote3. Keep Haiku when its two orders agree decisively. Otherwise require two agreeing seats among gpt-6-luna's net of both orders, gemini-3.8-flash's net of both orders, and Jev's original three-framing majority. If they do not produce a majority, the frozen base stands. No harm gate, pointwise reader or fitted rule was added.

Game scores are 1 for correct, 0 for incorrect and 0.5 for a tie. Provider-refused base items score zero. Paired intervals use 20,000 bootstrap draws resampling items within each subset, numpy default_rng seed 20261013, percentile endpoints 2.5 and 97.5. The estimator was checked for equal subset weighting, paired zero differences, constant gains and missing-stratum rejection. The complete-case analysis committed before scoring also supports the full cohort without changing weights or routing.

The old benchmark worktree was removed during cleanup. Its source was restored inside the owned worktree from pinned commit 0278595c. All six frozen SHA-256 values matched before resumed calls. Offline replay reproduces the saved decisions on all 1,048 non-refused items; the four provider refusals remain explicitly recorded. The three interrupted partial items replayed their saved first order and called only the unrecorded order under the explicit resume authorization.

All 1,052 IDs are unique and satisfy the registered DEV split. The 950 sampled TEST items were not used. {'The DEV gate is met; the originally authorized one-pass unsampled TEST confirmation is the next stage.' if gate else 'No TEST run is authorized by the registered gate, so TEST remains untouched.'}

Artifacts are in `research/astra-mm/data/`: `base.jsonl`, `haiku.jsonl`, `dev-calls.jsonl`, `dev-decisions.jsonl`, `paired-full.json`, `base-replay-audit.json` and `current-status.json`. The source archive, request bank and resume scripts are also retained. This report is saved both as `research/astra-mm/RESULT.md` and `scratchpad/opus/astra-mm.md`.
'''
assert '\u2013' not in text and '\u2014' not in text
(SCRATCH/'opus/astra-mm.md').write_text(text);(ROOT/'RESULT.md').write_text(text)
manifest={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in D.iterdir() if p.is_file()};(ROOT/'checkpoint-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='results'},indent=2))
