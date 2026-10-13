# MM-Eval frozen cascade: TEST confirmation

TEST status: complete. The complete remaining eligible population contains 1,212 items, sealed before the first TEST call at commit 2154225b and pushed to research/astra-mm-replicate. Current checkpoint: 1,212 base decisions, 48 escalations, 0 outstanding panel positions. Updated 2026-10-13T08:53:23.733626+00:00.

The fixed seed is `astra-mm-test-20261013-v1`. This is a census, so subset allocation exactly matches the remaining eligible population. Seeded ranks determine order within subsets, with proportional interleaving. Selection used no labels or outcomes. The original 950-item TEST sample, the 600-item pool sealed on research/ledger-mm at 5a357fa1, and every prior exposure in that lane's audit are excluded. There were 1,812 eligible never-scored TEST items before reserving the other lane's 600, leaving 1,212 here. ID intersections with both protected pools are empty. The seal, exclusion IDs, source hashes and request-bank hash are committed.

The candidate is exactly the frozen DEV candidate, including gpt-6-luna at low, Gemini 3.8 Flash with low thinking, and Jev's three original framings. The owner's medium setting belongs to a separate promptfoo matrix and was not used here. Gemini uses the authorized gemini-driftbench.key, a 180-second timeout, one retry and at most two concurrent calls. After the plugin-crash resume, total concurrency is at most four (previously six). No tuning or second TEST pass is permitted.

| Subset | Sealed items |
|---|---:|
| reasoning | 615 |
| chat | 46 |
| linguistics | 45 |
| language mixing | 311 |
| safety | 195 |

The main metric remains the equal-weight mean of the five subset means. The remaining chat and linguistics strata are small, so the larger overall item count does not guarantee a narrower macro interval than DEV.

## Full paired TEST result

Frozen base 89.49; cascade 91.54; paired difference +2.05 percentage points, 95% interval [+1.02, +3.29]. Both arms include all 1,212 sealed items. Wins / losses / unchanged: 36 / 2 / 1174. Exact two-sided sign-test p = 5.3988e-09. The +1.0-point gain with an interval excluding zero is confirmed on TEST.

| Subset | n | Frozen base | Cascade | Paired difference | Paired 95% interval |
|---|---:|---:|---:|---:|---:|
| reasoning | 615 | 95.37 | 96.59 | +1.22 | [+0.65, +1.87] |
| chat | 46 | 72.83 | 75.00 | +2.17 | [+0.00, +5.43] |
| linguistics | 45 | 90.56 | 94.44 | +3.89 | [+0.00, +8.89] |
| language mixing | 311 | 98.95 | 99.36 | +0.40 | [+0.00, +0.96] |
| safety | 195 | 89.74 | 92.31 | +2.56 | [+0.51, +4.87] |

Haiku agreed decisively on 1164 items; all 48 escalations have full panels. Intervals use 20,000 paired bootstrap draws within subset, numpy default_rng seed 20261013, percentile endpoints 2.5 and 97.5. Subset intervals use the same seed separately.

## TEST cost per 100

| Arm | Recorded USD / 100, excluding Jev |
|---|---:|
| Frozen base | 0.2471 |
| Haiku-first cascade | 0.2646 |
| Incremental panel cost | 0.0175 |

These inference costs count unique saved request hashes used in the final replay, including recorded provider refusals. Actual run spend below also retains every receipt if a repeated request occurred. Haiku costs come from CLI receipts. OpenAI is valued at the owner's 0.10 USD input and 0.50 USD output per million tokens (cached input 0.01); Gemini uses 0.75 input, 0.075 cached input and 3.75 output including thinking. Jev is excluded from the USD cap and cost figures.

## Spend and saved state

Recorded TEST spend: Haiku 2.99479172 USD, OpenAI 0.02207200 USD, Gemini 0.18990375 USD. Measured DEV plus TEST total: 4.07710569 USD against the 30 USD cap. DEV's three interrupted earlier Haiku calls have unknown remote completion and unreported charges, as documented below. The TEST plugin crash also left four occupied Haiku slots and two Gemini requests without completion receipts; their remote completion and charges are unknown. All saved hashes were reused, and only missing requests were retried under the owner's explicit resume instruction. No duplicate completed TEST receipt key has been observed.

TEST Jev usage: 249,932 input tokens, 3,003 output tokens, price not published. DEV Jev usage remains separately documented below.

Gemini waiting items: none. Waiting Gemini call positions: 0. Other pending panel positions: 0. Every completed response is checkpointed; successful request hashes are reused on resume. Artifacts live in `research/astra-mm/data/test*`; frozen source and prompt hashes remain unchanged.

---

# MM-Eval Haiku-first cascade: full DEV replication

All 1,052 registered DEV items are complete. The frozen base scores 88.53; the cascade scores 89.60. The paired gain is +1.07 percentage points, with a 95% interval of +0.21 to +1.97. The registered +1.0-point gate with an interval excluding zero is met.

## Full paired result

The metric is the unweighted mean of the five subset means. Both arms use the same 1,052 items. No missing panel was imputed, and no item was excluded. Wins / losses / unchanged: 26 / 7 / 1019. Exact two-sided sign-test p = 0.0013187.

| Subset | n | Frozen base | Cascade | Paired difference |
|---|---:|---:|---:|---:|
| reasoning | 398 | 96.61 | 97.24 | +0.63 |
| chat | 96 | 66.67 | 66.93 | +0.26 |
| linguistics | 93 | 90.32 | 92.20 | +1.88 |
| language mixing | 259 | 99.13 | 99.42 | +0.29 |
| safety | 206 | 89.93 | 92.23 | +2.31 |

Haiku agreed decisively on 1010 items. All 42 escalated items now have complete OpenAI, Gemini and Jev panels. The base had 4 provider refusals, scored zero; the cascade recovered positive credit on 4 of them (4627, 4900, 4261, 4154).

The original DEV400 selection score was 91.16 versus 89.65, a gain of +1.51. That was the selection result with gpt-5.4-mini. This independent DEV remainder uses the owner's required gpt-6-luna substitution, frozen before its first call. It is not an exact same-model replication of DEV400.

## Cost per 100

| Arm | Recorded inference USD / 100 items, excluding Jev |
|---|---:|
| Frozen base | 0.2586 |
| Haiku-first cascade | 0.2759 |
| Incremental panel cost | 0.0174 |

These figures include previously recorded Haiku inference and the unique saved request hashes used by the final replay. They describe recorded inference cost, separate from new spend. Limitation: 4 provider-refusal calls lack receipts, so these are observed-cost lower bounds. Three Haiku calls interrupted at the earlier owner pause also have unknown remote completion and unreported charges. Gemini's initial free-tier calls may have billed zero; the table values their observed tokens at paid-tier rates.

| Provider | New completed receipts across this replication | Recorded new USD |
|---|---:|---:|
| Haiku | 619 | 0.68741672 |
| OpenAI gpt-6-luna | 82 | 0.01864300 |
| Gemini 3.8 Flash | 81 | 0.16427850 |
| Total against the 30 USD cap | 782 | 0.87033822 |

Jev: 236,068 input tokens and 2,604 output tokens, price not published. Jev is excluded from the USD cap by owner instruction. OpenAI and Gemini costs use observed tokens at published rates; Haiku costs come from CLI receipts. Price sources: [OpenAI](https://developers.openai.com/api/docs/models/gpt-6-luna) and [Google](https://ai.google.dev/gemini-api/docs/pricing.md).

## Gemini completion and checkpoints

After billing confirmation, Gemini ran only with `~/.nexus-secrets/gemini-driftbench.key`, at two calls in flight, a 180-second timeout and one permitted retry per failed request. The original 68 missing call positions on 36 items were retained. Finishing the last 150 base decisions added items 2507 and 3240, bringing the billing-resume queue to 72 positions on 38 items. Shared identical request hashes reuse a saved result. The final waiting list is empty. No other Gemini key was used.

Every successful response was saved before a derived verdict. The earlier checkpoint contains two concurrent duplicate requests on identical-text orders, OpenAI item 2506 and Jev item 2605. Both receipts and charges remain included in new spend. An in-flight key guard prevents further duplicate dispatch; replay uses the last saved response per hash, matching the source recorder. All later completed hashes were reused.

## Frozen protocol and verification

Configuration was frozen at commit 359151f5 before the first call, based on origin/research/opus-mm at 2c87e59e and council commit 140f406a section 4.1. Resume began at 7e6ab851. The base is native direct c576, with per-order chat vote3. Keep Haiku when its two orders agree decisively. Otherwise require two agreeing seats among gpt-6-luna's net of both orders, gemini-3.8-flash's net of both orders, and Jev's original three-framing majority. If they do not produce a majority, the frozen base stands. No harm gate, pointwise reader or fitted rule was added.

Game scores are 1 for correct, 0 for incorrect and 0.5 for a tie. Provider-refused base items score zero. Paired intervals use 20,000 bootstrap draws resampling items within each subset, numpy default_rng seed 20261013, percentile endpoints 2.5 and 97.5. The estimator was checked for equal subset weighting, paired zero differences, constant gains and missing-stratum rejection. The complete-case analysis committed before scoring also supports the full cohort without changing weights or routing.

The old benchmark worktree was removed during cleanup. Its source was restored inside the owned worktree from pinned commit 0278595c. All six frozen SHA-256 values matched before resumed calls. Offline replay reproduces the saved decisions on all 1,048 non-refused items; the four provider refusals remain explicitly recorded. The three interrupted partial items replayed their saved first order and called only the unrecorded order under the explicit resume authorization.

All 1,052 IDs are unique and satisfy the registered DEV split. The 950 sampled TEST items were not used. The DEV gate is met; the originally authorized one-pass unsampled TEST confirmation is the next stage.

Artifacts are in `research/astra-mm/data/`: `base.jsonl`, `haiku.jsonl`, `dev-calls.jsonl`, `dev-decisions.jsonl`, `paired-full.json`, `base-replay-audit.json` and `current-status.json`. The source archive, request bank and resume scripts are also retained. This report is saved both as `research/astra-mm/RESULT.md` and `scratchpad/opus/astra-mm.md`.

---

# TEST: independent close-out (worktree mm-rep-opus, 2026-10-13)

The sealed one-pass TEST is complete on all 1,212 items. Frozen base 89.49, frozen cascade 91.54, paired difference +2.05 points, 95% interval +1.02 to +3.29. The registered bar (+1.0 with an interval above zero) is met on TEST.

How it finished: the runners that the crashed plugin had detached (pids 10383 to 10386) were still alive and completing the sealed queue under the four-slot cap. This lane started no model call, so no item was answered twice. Its work was a read-only harvest of their checkpoints followed by a fresh offline recomputation.

Checks run in this worktree:

- Base decisions: 1,212 rows, 1,212 unique IDs, equal to the sealed ID list. `test.json` matches the sealed SHA-256.
- Receipts: 2,634 Haiku, 333 panel (95 gpt-6-luna at low, 95 gemini-3.8-flash, 143 Jev), 3 recorded refusals. Zero duplicate request keys in each file. All panel receipts have status 200.
- Missing: 0 items, 0 pending panel positions, 0 excluded items. 48 escalations, all with full panels.
- Recomputation: frozen source restored from the pinned archive (hashes verified). `decisions.mts`, `paired.py` and `audit-base.mts` were rerun from the receipts. All three outputs are byte-identical to the runner's own. Replay audit: 1,209 validated, 3 provider refusals.

| Subset | n | Frozen base | Cascade | Paired difference | Paired 95% interval |
|---|---:|---:|---:|---:|---:|
| reasoning | 615 | 95.37 | 96.59 | +1.22 | +0.65 to +1.87 |
| chat | 46 | 72.83 | 75.00 | +2.17 | 0.00 to +5.43 |
| linguistics | 45 | 90.56 | 94.44 | +3.89 | 0.00 to +8.89 |
| language mixing | 311 | 98.95 | 99.36 | +0.40 | 0.00 to +0.96 |
| safety | 195 | 89.74 | 92.31 | +2.56 | +0.51 to +4.87 |

Wins / losses / unchanged: 36 / 2 / 1174 (losses: items 4409 and 283). Only reasoning and safety have subset intervals above zero; chat, linguistics and language mixing touch zero.

Sensitivity, not pre-registered: three safety items (4809, 4976, 4903) were Haiku provider refusals, scored zero for the base by the frozen rule and recovered by the panel. Without those three items (n = 1,209) the paired difference is +1.75, interval +0.77 to +2.96.

Cost: TEST recorded spend is Haiku 2.9948 USD, gpt-6-luna 0.0221 USD (0.10 input, 0.50 output per 1M tokens), Gemini 0.1899 USD. DEV plus TEST measured total is 4.0771 USD against the 30 USD cap. Per 100 items: base 0.2471 USD, cascade 0.2646 USD. Jev used 249,932 input and 3,003 output tokens, price not published, outside the cap. Unknown charges remain for the six calls in flight at the plugin crash (four Haiku, two Gemini).

Deviation from this lane's brief: the surviving runners used their own frozen transport settings (Gemini 180 s with one retry, other seats 300 s), not three tries at 300 s. No transport failure was left unresolved, so no further retry was needed.
