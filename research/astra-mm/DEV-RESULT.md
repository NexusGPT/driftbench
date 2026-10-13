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
