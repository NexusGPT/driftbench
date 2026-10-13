# Fresh hard rows

Main default is reported first. The primary cohort has 192 cases per row from the original 12 construction families, not the budget generator. The candidate is a separately registered third side on those exact cases, reusing the peer recordings. It is not an independent replication.

Report generated at 2026-10-13T04:00:36.727227+00:00. Primary registration `9c1c2ff8` and candidate registration `b63b9103` remain unchanged.

## Original 12 families

| Row | Main default | Frozen candidate | Peer |
|---|---:|---:|---:|
| promptfoo rubric | 185/192 (96.354%) | Pending | 184/192 (95.833%) |
| Langfuse reference correctness | 181/192 (94.271%) | Pending | 183/192 (95.312%) |

W counts only the named procedure correct; L counts only the peer correct. Both-correct and both-wrong pairs do not enter the exact tests.

| Row | Procedure | W | L | Both correct | Both wrong | Exact one-sided p | Exact two-sided McNemar p | Bar |
|---|---|---:|---:|---:|---:|---|---|---|
| promptfoo rubric | Main default | 3 | 2 | 182 | 5 | 1/2 = 0.5 | 1/1 = 1 | **equal** |
| Langfuse reference correctness | Main default | 8 | 10 | 173 | 1 | 49785/65536 = 0.7596588135 | 53381/65536 = 0.8145294189 | **equal** |

| Row | Procedure | Procedure accuracy, family bootstrap 95% | Peer accuracy, family bootstrap 95% | Paired difference, percentage points 95% | Procedure USD/100 | Peer USD/100 |
|---|---|---|---|---|---:|---:|
| promptfoo rubric | Main default | [90.625, 100.000] | [87.500, 100.000] | [-2.083, 4.167] | $0.04552943 | $0.03424781 |
| Langfuse reference correctness | Main default | [88.021, 98.958] | [87.500, 100.000] | [-9.375, 8.867] | $0.05490677 | $0.05215438 |

## Tests and interpretation

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
- Every recorded judge call resolves the haiku alias to `claude-haiku-5-5`. All sides have identical CLI model settings. There is one recorded answer per side and case, at most two calls concurrently, no retries and no tuning on outcomes.

## Optional map replication

The independently registered map cohort is pending. No map results are included here.

## Calls, chronology and spend

| Run | Calls | First call UTC | Last call UTC | Reported USD |
|---|---:|---|---|---:|
| Primary | 768 | 2026-10-13T03:30:16.210889+00:00 | 2026-10-13T04:00:16.120330+00:00 | $0.35872970 |

Total reported judge-call spend: **$0.35872970 of $10.00**. Costs are CLI-reported run costs, including cache behavior; orchestration and the isolated audit agent are not metered by this runner. Per-row and per-side start/completion rows are appended to `scratchpad/spend-ledger.md`. Reused primary peer calls are charged once.

Completed-run integrity checks verify request uniqueness, committed hashes, resolved model equality, cost completeness, the required run order and maximum concurrency of two. Completed calls finished before 07:30 Europe/Brussels. There were zero failed calls, unknown costs or retries.

## Family accuracy counts

| Cohort | Row | Family | Cases | Main default | Candidate | Peer |
|---|---|---|---:|---:|---:|---:|
| Original 12 families | promptfoo rubric | arithmetic | 16 | 16 | Pending | 16 |
| Original 12 families | promptfoo rubric | conjunction | 16 | 15 | Pending | 16 |
| Original 12 families | promptfoo rubric | cross-language | 16 | 16 | Pending | 16 |
| Original 12 families | promptfoo rubric | disjunction | 16 | 16 | Pending | 16 |
| Original 12 families | promptfoo rubric | later-contradiction | 16 | 16 | Pending | 16 |
| Original 12 families | promptfoo rubric | long-fluent | 16 | 16 | Pending | 16 |
| Original 12 families | promptfoo rubric | negation | 16 | 16 | Pending | 16 |
| Original 12 families | promptfoo rubric | partial-completion | 16 | 16 | Pending | 16 |
| Original 12 families | promptfoo rubric | period | 16 | 16 | Pending | 16 |
| Original 12 families | promptfoo rubric | quoted-claim | 16 | 15 | Pending | 16 |
| Original 12 families | promptfoo rubric | scope | 16 | 16 | Pending | 16 |
| Original 12 families | promptfoo rubric | tag-injection | 16 | 11 | Pending | 8 |
| Original 12 families | Langfuse reference correctness | conditions | 16 | 11 | Pending | 15 |
| Original 12 families | Langfuse reference correctness | entity-binding | 16 | 16 | Pending | 16 |
| Original 12 families | Langfuse reference correctness | fluent-extra | 16 | 16 | Pending | 16 |
| Original 12 families | Langfuse reference correctness | instruction-data | 16 | 15 | Pending | 16 |
| Original 12 families | Langfuse reference correctness | long-distractors | 16 | 16 | Pending | 16 |
| Original 12 families | Langfuse reference correctness | multilingual | 16 | 16 | Pending | 15 |
| Original 12 families | Langfuse reference correctness | near-number | 16 | 16 | Pending | 16 |
| Original 12 families | Langfuse reference correctness | negation | 16 | 13 | Pending | 16 |
| Original 12 families | Langfuse reference correctness | omission | 16 | 16 | Pending | 16 |
| Original 12 families | Langfuse reference correctness | quantifiers | 16 | 16 | Pending | 16 |
| Original 12 families | Langfuse reference correctness | revision | 16 | 14 | Pending | 16 |
| Original 12 families | Langfuse reference correctness | units | 16 | 16 | Pending | 9 |

## Evidence and free reproduction

All evidence lives in `comparisons/astra-hard/` on `research/astra-hard-fresh`: primary files at the directory root, third-side files in `candidates/`, and the independent replication in `map/`. Each contains its pre-registration manifest, full requests, dispatch journal, raw answers, model usage, timestamps, costs, case-level correctness, discordant ids and verification records. All analysis commands below use recordings and make no model calls.

```sh
python3 comparisons/astra-hard/score.py
python3 comparisons/astra-hard/verify.py
node --import tsx comparisons/astra-hard/supplement.mts
```
