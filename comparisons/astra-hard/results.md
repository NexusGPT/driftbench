# Fresh hard rows

Main default is reported first. The primary cohort has 192 cases per row from the original 12 construction families, not the budget generator. The candidate is a separately registered third side on those exact cases, reusing the peer recordings. It is not an independent replication.

Report generated at 2026-10-13T04:36:35.736090+00:00. Primary registration `9c1c2ff8` and candidate registration `b63b9103` remain unchanged. The owner later authorized six concurrent calls, a shared $20 cap and a 06:35 local last-call cutoff; transport amendments are separate.

## Original 12 families

| Row | Main default | Frozen candidate | Peer |
|---|---:|---:|---:|
| promptfoo rubric | 185/192 (96.354%) | 190/192 (98.958%) | 184/192 (95.833%) |
| Langfuse reference correctness | 181/192 (94.271%) | 192/192 (100.000%) | 183/192 (95.312%) |

W counts only the named procedure correct; L counts only the peer correct. Both-correct and both-wrong pairs do not enter the exact tests.

| Row | Procedure | W | L | Both correct | Both wrong | Exact one-sided p | Exact two-sided McNemar p | Bar |
|---|---|---:|---:|---:|---:|---|---|---|
| promptfoo rubric | Main default | 3 | 2 | 182 | 5 | 1/2 = 0.5 | 1/1 = 1 | **equal** |
| Langfuse reference correctness | Main default | 8 | 10 | 173 | 1 | 49785/65536 = 0.7596588135 | 53381/65536 = 0.8145294189 | **equal** |
| promptfoo rubric | Frozen candidate | 7 | 1 | 183 | 1 | 9/256 = 0.03515625 | 9/128 = 0.0703125 | **lead** |
| Langfuse reference correctness | Frozen candidate | 9 | 0 | 183 | 0 | 1/512 = 0.001953125 | 1/256 = 0.00390625 | **lead** |

| Row | Procedure | Procedure accuracy, family bootstrap 95% | Peer accuracy, family bootstrap 95% | Paired difference, percentage points 95% | Procedure USD/100 | Peer USD/100 |
|---|---|---|---|---|---:|---:|
| promptfoo rubric | Main default | [90.625, 100.000] | [87.500, 100.000] | [-2.083, 4.167] | $0.04552943 | $0.03424781 |
| Langfuse reference correctness | Main default | [88.021, 98.958] | [87.500, 100.000] | [-9.375, 8.867] | $0.05490677 | $0.05215438 |
| promptfoo rubric | Frozen candidate | [97.396, 100.000] | [87.500, 100.000] | [-1.562, 10.938] | $0.04408573 | $0.03424781 |
| Langfuse reference correctness | Frozen candidate | [100.000, 100.000] | [87.500, 100.000] | [0.000, 12.500] | $0.04353318 | $0.05215438 |

| Row | Procedure | Procedure inconclusive | Peer inconclusive |
|---|---|---:|---:|
| promptfoo rubric | Main default | 7 | 0 |
| Langfuse reference correctness | Main default | 0 | 0 |
| promptfoo rubric | Frozen candidate | 2 | 0 |
| Langfuse reference correctness | Frozen candidate | 0 | 0 |

## Separate map replication

| Row | Main default | Frozen candidate | Peer |
|---|---:|---:|---:|
| promptfoo rubric | 154/156 (98.718%) | 155/156 (99.359%) | 142/156 (91.026%) |
| Langfuse reference correctness | 173/180 (96.111%) | 178/180 (98.889%) | 163/180 (90.556%) |

W counts only the named procedure correct; L counts only the peer correct. Both-correct and both-wrong pairs do not enter the exact tests.

| Row | Procedure | W | L | Both correct | Both wrong | Exact one-sided p | Exact two-sided McNemar p | Bar |
|---|---|---:|---:|---:|---:|---|---|---|
| promptfoo rubric | Main default | 13 | 1 | 141 | 1 | 15/16384 = 0.0009155273438 | 15/8192 = 0.001831054688 | **lead** |
| Langfuse reference correctness | Main default | 17 | 7 | 156 | 0 | 536155/16777216 = 0.03195732832 | 536155/8388608 = 0.06391465664 | **equal** |
| promptfoo rubric | Frozen candidate | 13 | 0 | 142 | 1 | 1/8192 = 0.0001220703125 | 1/4096 = 0.000244140625 | **lead** |
| Langfuse reference correctness | Frozen candidate | 16 | 1 | 162 | 1 | 9/65536 = 0.0001373291016 | 9/32768 = 0.0002746582031 | **lead** |

| Row | Procedure | Procedure accuracy, family bootstrap 95% | Peer accuracy, family bootstrap 95% | Paired difference, percentage points 95% | Procedure USD/100 | Peer USD/100 |
|---|---|---|---|---|---:|---:|
| promptfoo rubric | Main default | [96.855, 100.000] | [74.847, 100.000] | [-1.361, 22.785] | $0.07078051 | $0.04998976 |
| Langfuse reference correctness | Main default | [90.449, 100.000] | [73.770, 100.000] | [-6.977, 24.294] | $0.06894739 | $0.06753556 |
| promptfoo rubric | Frozen candidate | [98.113, 100.000] | [74.847, 100.000] | [0.000, 23.256] | $0.05695060 | $0.04998976 |
| Langfuse reference correctness | Frozen candidate | [97.297, 100.000] | [73.770, 100.000] | [0.000, 24.022] | $0.05848094 | $0.06753556 |

| Row | Procedure | Procedure inconclusive | Peer inconclusive |
|---|---|---:|---:|
| promptfoo rubric | Main default | 2 | 0 |
| Langfuse reference correctness | Main default | 0 | 0 |
| promptfoo rubric | Frozen candidate | 1 | 0 |
| Langfuse reference correctness | Frozen candidate | 0 | 0 |

Original-cohort saturation, marked after the recorded third side with no filtering:

| Row | All three correct | All three wrong | Mixed correctness |
|---|---:|---:|---:|
| promptfoo rubric | 181 | 0 | 11 |
| Langfuse reference correctness | 173 | 0 | 19 |

## Tests and interpretation

Main default remains equal on both original-family rows. In the separate map replication, its rubric row meets the two-sided bar and its reference row stays equal. Frozen candidates meet the requested one-sided bar on both rows in both cohorts. Every family-clustered interval for the paired accuracy difference includes or touches zero. The nominal leads remain sensitive to which construction families are sampled.

For W wins and L losses, the exact one-sided sign test is sum(comb(W+L,k), k=W..W+L) / 2**(W+L). This is also the directional exact McNemar test. The two-sided exact McNemar p is min(1, 2 * sum(comb(W+L,k), k=0..min(W,L)) / 2**(W+L)). Zero discordant pairs gives p=1. Inconclusive predictions count as wrong.

Main default requires higher accuracy and two-sided exact McNemar p below 0.05 for a lead. The frozen candidate uses the requested higher-accuracy and exact one-sided p below 0.05 bar. Otherwise the row stays equal. Equal is the decision label, not a demonstrated equivalence margin. No cohorts are pooled and no multiple-test adjustment is applied.

The bootstrap resamples all 12 construction families with replacement, carrying every paired case within each sampled family. It reports case-weighted means and their paired difference, using 20,000 draws, percentile 95% intervals and seed 2619092984. Exact p-values are nominal case-level tests; repeated templates and shared profiles limit independence. Twelve clusters and a narrow fictional domain also limit generalization. A bootstrap interval of [0,0] at saturation does not establish population equivalence.

## Registration and procedures

- Main source: `5a90bfb698d2200d391fb3d626e316744d22854e`, the fetched origin/main used to create `research/astra-hard-fresh`. Production source and previous tuning and held-out sets remain unchanged.
- Original cohort: seed `20261217`; 192 cases per row, 96 pass and 96 fail, eight of each label per family. Labels are planted by the original generator code. All data is fictional and exact payload overlap with prior tuning and held-out sets is zero.
- Primary cases, requests and procedures were committed at `9c1c2ff8783b02d7dffa1b9dcd9b638405f6dce4` before its first call. Its 117 frozen file hashes verify.
- Main default uses current main buildPrompt and parseJudgeText, without optional answer contracts, requirements, fact audits or prompt overrides.
- promptfoo uses its pinned native DEFAULT_GRADING_PROMPT, native JSON extraction and deriveVerdictFromGrader without a custom threshold.
- Langfuse uses its pinned native managed Correctness template, the previously selected threshold 0.5 and the original comparison JSON decoder with strict quote repair.
- The promptfoo candidate is the frozen criterion ledger procedure `d7f5e226bf5afe7b955ee0f2247835cd19953001c196dcc7260d1f0c37922587`. The Langfuse candidate is the fact ledger in `comparisons/langfuse/hard/audit.txt`, SHA-256 `5ab527bec76758641fcfd13ebe7c576486ae145fb2cce183a25d9b2838621ca8`.
- Candidate requests and decoders were committed at `b63b910349938b2a15552544184aa527a94bba60` before candidate calls. The candidate side reuses all primary peer answers unchanged, with no additional peer cost.
- Every recorded judge call resolves the haiku alias to `claude-haiku-5-5`. All sides have identical CLI model settings. There is one recorded answer per side and case, no retries and no tuning on outcomes. Primary used two concurrent calls. Candidate used two for the first 160 calls, then six under amendment `75ffb919`. All 160 started calls had successful recordings before the pause; none was lost or retried. Map uses six continuous workers under `stream-registration.json`, committed before its first call. These amendments change transport only.

## Optional map replication

Completed independently under registration `25fee06e9213a377116f00fba510b7bb701548d4`. Its source families remain the original 12; its categorical schedule and numeric settings come from native map generation. It is not pooled with the primary cohort.

- Construction freeze: `7ee661e3ddb1e979eb0940c9fe34fbe6e1db779a`. Hidden seed `2274381994` is the first eight SHA-256 hex digits of that commit, converted to an integer.
- Each map ran `generate --budget 192 --t 2`. Only the 192 budget rows were rendered, excluding the 12 graph scaffolding rows. Axes are family and planted truth. Numeric settings control reply length, number size and distractor count; reply length is a target minimum, and reference prices use the closest original numeric step.
- Code-only gates before sealing: label metadata leakage check, native character 3-5 gram TF-IDF cosine deduplication at 0.95 against earlier kept cases and the primary cases, then deterministic trimming for equal pass/fail labels. This is lexical cosine, not a learned semantic embedding.

| Row | Generated | Leak drops | Cosine drops | Balance drops | Sealed | Pass / fail | Constant-pass accuracy |
|---|---:|---:|---:|---:|---:|---|---:|
| promptfoo rubric | 192 | 0 | 31 | 5 | 156 | 78 / 78 | 50% |
| Langfuse reference correctness | 192 | 0 | 10 | 2 | 180 | 90 / 90 | 50% |

One isolated sub-agent saw only the 72-item packet and label rubric, with no planted labels, judge outputs or scores. Three labels per family per row were audited; all 72 matched. Three reference cases (002, 110 and 170) received an ambiguity note about a monthly modifier shared by fee and allowance. They retain the original contextual reading and remain in every denominator unchanged.

All 12 families survive. Raw two-way coverage was 24/24 for each row; native space completion on retained specs reports 20/24 rubric cells and 23/24 reference cells. The completeness estimator assumes independent conversations and is optimistic for a coverage-directed generator, so no full post-gate coverage claim is made.

Native holdout seals record the retained construction specs. A separately committed fixture seal binds the actual case files and a per-side query budget of one. The journaled comparison runner transports the judge requests; native holdout score is not the transport. All seals, requests, decoders, audit files and code were committed before the first map call.

Saturation was marked after all recorded calls, with no filtering:

| Row | All three correct | All three wrong | Mixed correctness |
|---|---:|---:|---:|
| promptfoo rubric | 141 | 0 | 15 |
| Langfuse reference correctness | 155 | 0 | 25 |

## Calls, chronology and spend

| Run | Calls | First call UTC | Last call UTC | Reported USD |
|---|---:|---|---|---:|
| Primary | 768 | 2026-10-13T03:30:16.210889+00:00 | 2026-10-13T04:00:16.120330+00:00 | $0.35872970 |
| Candidate third side | 384 | 2026-10-13T04:00:28.904173+00:00 | 2026-10-13T04:14:17.957581+00:00 | $0.16822830 |
| Separate map replication | 1008 | 2026-10-13T04:14:37.443207+00:00 | 2026-10-13T04:34:47.593062+00:00 | $0.62817956 |

Total reported judge-call spend: **$1.15513756 of $20.00**. Costs are CLI-reported run costs, including cache behavior; orchestration and the isolated audit agent are not metered by this runner. Per-row and per-side start/completion rows are appended to `scratchpad/spend-ledger.md`. Reused primary peer calls are charged once.

Completed-run integrity checks verify request uniqueness, committed hashes, resolved model equality, cost completeness, the required run order and maximum concurrency of six (two for the primary). All amended dispatches occurred before 06:35 Europe/Brussels, and completed calls finished before 06:40. There were zero failed calls, unknown costs or retries.

## Family accuracy counts

| Cohort | Row | Family | Cases | Main default | Candidate | Peer |
|---|---|---|---:|---:|---:|---:|
| Original 12 families | promptfoo rubric | arithmetic | 16 | 16 | 16 | 16 |
| Original 12 families | promptfoo rubric | conjunction | 16 | 15 | 16 | 16 |
| Original 12 families | promptfoo rubric | cross-language | 16 | 16 | 16 | 16 |
| Original 12 families | promptfoo rubric | disjunction | 16 | 16 | 16 | 16 |
| Original 12 families | promptfoo rubric | later-contradiction | 16 | 16 | 16 | 16 |
| Original 12 families | promptfoo rubric | long-fluent | 16 | 16 | 15 | 16 |
| Original 12 families | promptfoo rubric | negation | 16 | 16 | 16 | 16 |
| Original 12 families | promptfoo rubric | partial-completion | 16 | 16 | 16 | 16 |
| Original 12 families | promptfoo rubric | period | 16 | 16 | 16 | 16 |
| Original 12 families | promptfoo rubric | quoted-claim | 16 | 15 | 16 | 16 |
| Original 12 families | promptfoo rubric | scope | 16 | 16 | 16 | 16 |
| Original 12 families | promptfoo rubric | tag-injection | 16 | 11 | 15 | 8 |
| Original 12 families | Langfuse reference correctness | conditions | 16 | 11 | 16 | 15 |
| Original 12 families | Langfuse reference correctness | entity-binding | 16 | 16 | 16 | 16 |
| Original 12 families | Langfuse reference correctness | fluent-extra | 16 | 16 | 16 | 16 |
| Original 12 families | Langfuse reference correctness | instruction-data | 16 | 15 | 16 | 16 |
| Original 12 families | Langfuse reference correctness | long-distractors | 16 | 16 | 16 | 16 |
| Original 12 families | Langfuse reference correctness | multilingual | 16 | 16 | 16 | 15 |
| Original 12 families | Langfuse reference correctness | near-number | 16 | 16 | 16 | 16 |
| Original 12 families | Langfuse reference correctness | negation | 16 | 13 | 16 | 16 |
| Original 12 families | Langfuse reference correctness | omission | 16 | 16 | 16 | 16 |
| Original 12 families | Langfuse reference correctness | quantifiers | 16 | 16 | 16 | 16 |
| Original 12 families | Langfuse reference correctness | revision | 16 | 14 | 16 | 16 |
| Original 12 families | Langfuse reference correctness | units | 16 | 16 | 16 | 9 |
| Separate map replication | promptfoo rubric | arithmetic | 11 | 11 | 11 | 11 |
| Separate map replication | promptfoo rubric | conjunction | 14 | 14 | 14 | 14 |
| Separate map replication | promptfoo rubric | cross-language | 13 | 13 | 13 | 13 |
| Separate map replication | promptfoo rubric | disjunction | 12 | 12 | 12 | 12 |
| Separate map replication | promptfoo rubric | later-contradiction | 14 | 14 | 14 | 14 |
| Separate map replication | promptfoo rubric | long-fluent | 14 | 14 | 14 | 14 |
| Separate map replication | promptfoo rubric | negation | 10 | 10 | 10 | 10 |
| Separate map replication | promptfoo rubric | partial-completion | 14 | 14 | 14 | 13 |
| Separate map replication | promptfoo rubric | period | 13 | 13 | 13 | 13 |
| Separate map replication | promptfoo rubric | quoted-claim | 11 | 10 | 11 | 11 |
| Separate map replication | promptfoo rubric | scope | 14 | 14 | 14 | 14 |
| Separate map replication | promptfoo rubric | tag-injection | 16 | 15 | 15 | 3 |
| Separate map replication | Langfuse reference correctness | conditions | 16 | 13 | 15 | 15 |
| Separate map replication | Langfuse reference correctness | entity-binding | 16 | 16 | 16 | 16 |
| Separate map replication | Langfuse reference correctness | fluent-extra | 14 | 14 | 14 | 14 |
| Separate map replication | Langfuse reference correctness | instruction-data | 16 | 16 | 16 | 16 |
| Separate map replication | Langfuse reference correctness | long-distractors | 14 | 14 | 14 | 14 |
| Separate map replication | Langfuse reference correctness | multilingual | 16 | 16 | 16 | 15 |
| Separate map replication | Langfuse reference correctness | near-number | 12 | 12 | 12 | 12 |
| Separate map replication | Langfuse reference correctness | negation | 13 | 9 | 13 | 13 |
| Separate map replication | Langfuse reference correctness | omission | 15 | 15 | 15 | 15 |
| Separate map replication | Langfuse reference correctness | quantifiers | 16 | 16 | 16 | 16 |
| Separate map replication | Langfuse reference correctness | revision | 16 | 16 | 16 | 16 |
| Separate map replication | Langfuse reference correctness | units | 16 | 16 | 15 | 1 |

## Evidence and free reproduction

All evidence lives in `comparisons/astra-hard/` on `research/astra-hard-fresh`: primary files at the directory root, third-side files in `candidates/`, and the independent replication in `map/`. Each contains its pre-registration manifest, full requests, dispatch journal, raw answers, model usage, timestamps, costs, case-level correctness, discordant ids and verification records. All analysis commands below use recordings and make no model calls.

```sh
python3 comparisons/astra-hard/score.py
python3 comparisons/astra-hard/verify.py
node --import tsx comparisons/astra-hard/supplement.mts
python3 comparisons/astra-hard/operations_analysis.py candidates
node --import tsx comparisons/astra-hard/supplement.mts comparisons/astra-hard/candidates/scores.json
python3 comparisons/astra-hard/stream_analysis.py
node --import tsx comparisons/astra-hard/supplement.mts comparisons/astra-hard/map/default-scores.json
node --import tsx comparisons/astra-hard/supplement.mts comparisons/astra-hard/map/candidate-scores.json
```
