# LongJudge writing pair ledger study

Measured state: 2026-10-13T09:39:11.817049+00:00. Branch `research/ledger-wp`, local head `d116a155a3b5bbcdc4c49e6a365d764df0dfae6f`.

## Outcome

The model table below is the observed result, including pending and partial cells. No global superiority claim is made. This row is preregistered as no significant loss, not an assumed win.

Gemini is parked pending an owner-confirmed credit top-up. The owner reports depleted prepaid credits from another cell; this cell makes no new Gemini probe. Haiku and Luna continue.

Actual recorded model spend: 4.41376539 USD. Unsettled reservations: 2.45000000 USD. Total lane cap: 35 USD. Recorded call attempts: 2143. Source: `results/spend.jsonl` and `results/calls.jsonl`.

## Licence and label provenance

- WritingPreferenceBench is attributed to Shuangshuang Ying and coauthors. Both fetched dataset READMEs specify ODC-BY, research and educational use, attribution, and respect for referenced data licences.
- Sources: [dataset repository](https://github.com/WritingPreferenceBench/Writing-Preference-Bench), [Hugging Face release](https://huggingface.co/datasets/m-a-p/Writing-Preference-Bench), [paper section 2.1](https://arxiv.org/html/2510.14616v2#S2.SS1). Fetched URLs and hashes: `sources/receipts.json` and `sources/hf-receipts.json`.
- The paper describes expert human quality scoring and preference selection. The distributed chosen/rejected fields supply gold labels. Individual annotator ballots are not independently recovered.
- Three Chinese release records have chosen and rejected scores of zero. Those ambiguous labels are excluded before selection. Their indices and content hashes are in `seals/manifest.json`.
- Full licence, label mapping, source-family caveat and scope: `examples/ledger-wp/PROVENANCE.md`.

## Sealed pool

- Source population: 1800 pairs. Eligible fresh pool: 1303 pairs. The test seal selects 173 pairs with seeded SHA-256 ranks, without contestant outcomes.
- Test has 346 games, 146 request clusters, 122 English pairs and 51 Chinese pairs. All LongJudge exact pairs, request IDs and question hashes are excluded.
- Recorded-ID union: 54 files, 4,080 IDs. The named `codex-mm` and `astra-hard` worktrees are absent. Novelty is bounded to the available enumerated recordings; model pretraining is unverified.
- Dev and pilot are previously evaluated LongJudge dev requests, mutually request-disjoint and separate from the new test pool.
- Counts, source mapping and exclusion audit: `seals/manifest.json`, `seals/recorded-id-union.json`, and `seals/recording-inventory.json`.

| Seal | Pairs | Pre-call commit | SHA-256 |
|---|---:|---|---|
| test | 173 | `650b07f5` | `178754731d81f74abd2f6c001eca58ef4d16df7bbcd22bb702611e7bd09e7f0a` |
| dev | 30 | `6dc58cc0` | `d47cdd3a3dab25e87e49bce60cbcb19706a7330ca4776b50df8745912f267c9b` |
| validity | 20 | `212049e6` | `e394ed458ddb9c05ccfc3ce3d21ba15facbfc4acb6142a28ab07ec4d5bb568c5` |
| pilot | 20 | `57a11548` | `a4d1b6f4ae7046f4bd17d7dc79e278c32f3e883fb93c83937c0a7721c7d25c15` |
| fixtures | 6 | `212049e6` | `e0873175e7f63f53bab63ff05899917247ecf2783421da427a349bfcea0ad469` |

## Model cells

Scores use normalized presentation games. Ties and unparsed pair-ledger or promptfoo games are wrong. Reader-first retains its frozen longer-response fallback when a rubric ballot is invalid; the error count exposes that behavior.

| Model | Contestant | Pairs / 173 | Correct games | Accuracy % | Wilson 95% | Errors | USD / 100 pairs | USD / 100 games |
|---|---|---:|---:|---:|---|---:|---:|---:|
| haiku | pair-ledger | 0 | 0/0 | pending | pending | 0 | pending | pending |
| haiku | reader-first-c50b2dc3 | 0 | 0/0 | pending | pending | 0 | pending | pending |
| haiku | promptfoo | 0 | 0/0 | pending | pending | 0 | pending | pending |
| gpt-6-luna | pair-ledger | 0 | 0/0 | pending | pending | 0 | pending | pending |
| gpt-6-luna | reader-first-c50b2dc3 | 0 | 0/0 | pending | pending | 0 | pending | pending |
| gpt-6-luna | promptfoo | 0 | 0/0 | pending | pending | 0 | pending | pending |
| gemini-3.8-flash | pair-ledger | 0 | 0/0 | pending | pending | 0 | pending | pending |
| gemini-3.8-flash | reader-first-c50b2dc3 | 0 | 0/0 | pending | pending | 0 | pending | pending |
| gemini-3.8-flash | promptfoo | 0 | 0/0 | pending | pending | 0 | pending | pending |

Reader-first is the separate opt-in PR 157 row at `c50b2dc3`. It has a length prior and a defect-gated override. It is not included in the primary pair-ledger family. Both its games share one normalized decision; pair-ledger reconciliation does the same. Raw readings remain in `results/decisions.jsonl`.

| Model | Challenger vs promptfoo | Matched pairs | Wins / losses | Difference, points | Request-cluster 95% | Exact two-sided p | Holm-18 |
|---|---|---:|---:|---:|---|---:|---|
| haiku | pair-ledger | 0 | 0/0 | pending | pending | pending | pending full primary family |
| haiku | reader-first-c50b2dc3 | 0 | 0/0 | pending | pending | pending | not applicable, exploratory |
| gpt-6-luna | pair-ledger | 0 | 0/0 | pending | pending | pending | pending full primary family |
| gpt-6-luna | reader-first-c50b2dc3 | 0 | 0/0 | pending | pending | pending | not applicable, exploratory |
| gemini-3.8-flash | pair-ledger | 0 | 0/0 | pending | pending | pending | pending full primary family |
| gemini-3.8-flash | reader-first-c50b2dc3 | 0 | 0/0 | pending | pending | pending | not applicable, exploratory |

Per-cell game McNemar is the requested nominal test. Games sharing a pair and request are dependent. Interpret the request-cluster interval alongside that p value. Holm awaits the complete cross-benchmark primary family. Reader-first remains exploratory. Source: `results/cells.json` and frozen `stats.py`.

## Cheaters on the identical test seal

| Control | Correct games | Accuracy % | Wilson 95% | USD |
|---|---:|---:|---|---:|
| longer-wins | 234/346 | 67.63 | 62.53 to 72.34 | 0 |
| constant-FIRST | 173/346 | 50.00 | 44.76 to 55.24 | 0 |
| refusal-wins | 0/346 | 0.00 | 0.00 to 1.10 | 0 |

Longer-wins uses whitespace units in English and Han characters in Chinese, matching the frozen reader feature. The test control scores 234/346 games, 67.63%. This baseline is independent of model judging and is not evidence of superior writing assessment.

## Pilot and dev checks

| Stage | Model | Contestant | Pairs | Accuracy % | Projected test USD | Noise flips / comparisons | Fixture seat | Cheater bar |
|---|---|---|---:|---:|---:|---|---|---|
| pilot | haiku | pair-ledger | 20 | 80.00 | 1.1296 | pending/pending | pending | pending |
| pilot | haiku | reader-first-c50b2dc3 | 20 | 75.00 | 1.3568 | pending/pending | pending | pending |
| pilot | haiku | promptfoo | 20 | 72.50 | 0.7184 | pending/pending | pending | pending |
| pilot | gpt-6-luna | pair-ledger | 20 | 65.00 | 0.4196 | pending/pending | pending | pending |
| pilot | gpt-6-luna | reader-first-c50b2dc3 | 20 | 75.00 | 0.5592 | pending/pending | pending | pending |
| pilot | gpt-6-luna | promptfoo | 20 | 55.00 | 0.2350 | pending/pending | pending | pending |
| pilot | gemini-3.8-flash | pair-ledger | 20 | 60.00 | 3.3606 | pending/pending | pending | pending |
| pilot | gemini-3.8-flash | reader-first-c50b2dc3 | 20 | 75.00 | 5.5983 | pending/pending | pending | pending |
| pilot | gemini-3.8-flash | promptfoo | 20 | 75.00 | 2.4523 | pending/pending | pending | pending |
| dev | haiku | pair-ledger | 30 | 60.00 | 1.2059 | 10/108 | True | False |
| dev | haiku | reader-first-c50b2dc3 | 30 | 73.33 | 1.4381 | 2/104 | False | False |
| dev | haiku | promptfoo | 30 | 48.33 | 0.7693 | 9/104 | False | False |
| dev | gpt-6-luna | pair-ledger | 30 | 50.00 | 0.4394 | 12/100 | True | False |
| dev | gpt-6-luna | reader-first-c50b2dc3 | 30 | 73.33 | 0.6021 | 0/100 | False | False |
| dev | gpt-6-luna | promptfoo | 30 | 53.33 | 0.2592 | 2/104 | True | False |
| dev | gemini-3.8-flash | pair-ledger | 0 | pending | pending | 0/0 | True | pending |
| dev | gemini-3.8-flash | reader-first-c50b2dc3 | 0 | pending | pending | 0/0 | False | pending |
| dev | gemini-3.8-flash | promptfoo | 0 | pending | pending | 0/0 | True | pending |

Detailed three-repeat noise, six planted fixtures, kappa, label-preserving, injection and label-flipping checks: `results/phase-report.json`. Unrun checks are pending, not passed. Source and parser remain frozen; no tuning follows these observations.

| Model | Contestant | Edit | Observed / expected pairs | Consistent games | Consistency % | Preregistered bar % | Verdict |
|---|---|---|---:|---:|---:|---:|---|
| haiku | pair-ledger | relabel | 6/6 | 12/12 | 100.00 | 95 | pass |
| haiku | pair-ledger | markdown | 4/4 | 8/8 | 100.00 | 95 | pass |
| haiku | pair-ledger | injection | 4/4 | 8/8 | 100.00 | 100 | pass |
| haiku | pair-ledger | label-flip | 6/6 | 12/12 | 100.00 | 90 | pass |
| haiku | reader-first-c50b2dc3 | relabel | 6/6 | 12/12 | 100.00 | 95 | pass |
| haiku | reader-first-c50b2dc3 | markdown | 4/4 | 8/8 | 100.00 | 95 | pass |
| haiku | reader-first-c50b2dc3 | injection | 4/4 | 6/8 | 75.00 | 100 | fail |
| haiku | reader-first-c50b2dc3 | label-flip | 6/6 | 4/12 | 33.33 | 90 | fail |
| haiku | promptfoo | relabel | 6/6 | 9/12 | 75.00 | 95 | fail |
| haiku | promptfoo | markdown | 4/4 | 7/8 | 87.50 | 95 | fail |
| haiku | promptfoo | injection | 4/4 | 7/8 | 87.50 | 100 | fail |
| haiku | promptfoo | label-flip | 6/6 | 10/12 | 83.33 | 90 | fail |
| gpt-6-luna | pair-ledger | relabel | 6/6 | 12/12 | 100.00 | 95 | pass |
| gpt-6-luna | pair-ledger | markdown | 4/4 | 8/8 | 100.00 | 95 | pass |
| gpt-6-luna | pair-ledger | injection | 4/4 | 8/8 | 100.00 | 100 | pass |
| gpt-6-luna | pair-ledger | label-flip | 6/6 | 12/12 | 100.00 | 90 | pass |
| gpt-6-luna | reader-first-c50b2dc3 | relabel | 6/6 | 12/12 | 100.00 | 95 | pass |
| gpt-6-luna | reader-first-c50b2dc3 | markdown | 4/4 | 8/8 | 100.00 | 95 | pass |
| gpt-6-luna | reader-first-c50b2dc3 | injection | 4/4 | 6/8 | 75.00 | 100 | fail |
| gpt-6-luna | reader-first-c50b2dc3 | label-flip | 6/6 | 4/12 | 33.33 | 90 | fail |
| gpt-6-luna | promptfoo | relabel | 6/6 | 12/12 | 100.00 | 95 | pass |
| gpt-6-luna | promptfoo | markdown | 4/4 | 8/8 | 100.00 | 95 | pass |
| gpt-6-luna | promptfoo | injection | 4/4 | 8/8 | 100.00 | 100 | pass |
| gpt-6-luna | promptfoo | label-flip | 6/6 | 12/12 | 100.00 | 90 | pass |
| gemini-3.8-flash | pair-ledger | relabel | 6/6 | 12/12 | 100.00 | 95 | pass |
| gemini-3.8-flash | pair-ledger | markdown | 4/4 | 8/8 | 100.00 | 95 | pass |
| gemini-3.8-flash | pair-ledger | injection | 3/4 | 6/6 | 100.00 | 100 | pending |
| gemini-3.8-flash | pair-ledger | label-flip | 5/6 | 10/10 | 100.00 | 90 | pending |
| gemini-3.8-flash | reader-first-c50b2dc3 | relabel | 5/6 | 10/10 | 100.00 | 95 | pending |
| gemini-3.8-flash | reader-first-c50b2dc3 | markdown | 4/4 | 8/8 | 100.00 | 95 | pass |
| gemini-3.8-flash | reader-first-c50b2dc3 | injection | 3/4 | 4/6 | 66.67 | 100 | pending |
| gemini-3.8-flash | reader-first-c50b2dc3 | label-flip | 5/6 | 4/10 | 40.00 | 90 | pending |
| gemini-3.8-flash | promptfoo | relabel | 6/6 | 12/12 | 100.00 | 95 | pass |
| gemini-3.8-flash | promptfoo | markdown | 3/4 | 6/6 | 100.00 | 95 | pending |
| gemini-3.8-flash | promptfoo | injection | 3/4 | 6/6 | 100.00 | 100 | pending |
| gemini-3.8-flash | promptfoo | label-flip | 5/6 | 10/10 | 100.00 | 90 | pending |

Edit consistency compares each variant with the first sealed fixture reading. Relabelling maps the choice back; label-flipping edits require the opposite choice. Planted accuracy is also retained in `results/validity-checks.json`. These are small planted checks, not estimates over arbitrary writing.

## Runtime audit

| Model | Contestant | Recorded attempts | Output-limit finishes | Provider errors | HTTP 429, all / test |
|---|---|---:|---:|---:|---:|
| haiku | pair-ledger | 328 | 0 | 0 | 0/0 |
| haiku | reader-first-c50b2dc3 | 288 | 0 | 0 | 0/0 |
| haiku | promptfoo | 288 | 0 | 0 | 0/0 |
| gpt-6-luna | pair-ledger | 322 | 0 | 3 | 0/0 |
| gpt-6-luna | reader-first-c50b2dc3 | 290 | 0 | 3 | 0/0 |
| gpt-6-luna | promptfoo | 288 | 0 | 0 | 0/0 |
| gemini-3.8-flash | pair-ledger | 116 | 0 | 0 | 0/0 |
| gemini-3.8-flash | reader-first-c50b2dc3 | 113 | 25 | 2 | 1/0 |
| gemini-3.8-flash | promptfoo | 110 | 0 | 0 | 0/0 |

The common HTTP output limit can truncate a reasoning-heavy response. This is recorded, not repaired outside the frozen contract. In the separate reader-first row, an invalid ballot can still yield the frozen length fallback. Source: `results/calls.jsonl`.

| Scope | Model | Ordered readings | Schema re-asks | Recovered | Re-ask USD, already in total |
|---|---|---:|---:|---:|---:|
| all phases | haiku | 328 | 0 | 0 | 0.00000000 |
| all phases | gpt-6-luna | 318 | 0 | 0 | 0.00000000 |
| all phases | gemini-3.8-flash | 116 | 0 | 0 | 0.00000000 |
| test | haiku | 0 | 0 | 0 | 0.00000000 |
| test | gpt-6-luna | 0 | 0 | 0 | 0.00000000 |
| test | gemini-3.8-flash | 0 | 0 | 0 | 0.00000000 |

The owner explicitly preserves the frozen core single schema re-ask after malformed JSON. The no-returned-answer-retry rule applies to transport wrappers. Frequencies count `ledger.reask` in completed pair readings; their second attempt cost is included in each decision and the overall spend. Source: `results/reasks.json` and `results/decisions.jsonl`.

## Freeze and execution

- Core: [PR 168](https://github.com/achammah/driftbench/pull/168), `2bb0a7a787ca4466ff69d204f2380a7ad19cc056`, remote hash verified before calls.
- Reader-first: [PR 157](https://github.com/achammah/driftbench/pull/157), source snapshot `c50b2dc3`.
- Promptfoo select-best: `801428268b5e421b2f6994332f6a06f86b27bb1f`, verbatim attributed template and MIT notice.
- Original judge freeze commit: `a4ae4b33`. Initial freeze SHA-256: `1fb32801af8549c7a4bef7a6c271c1799e950a84316e9fcb027ef757a36b3682`, preserved in `freeze-initial.json`. Current freeze SHA-256: `921c085acf73242d59d99b63e060bf06f42e2f60120367599ecc51f81be7a197`. The 191 exact file hashes are in `freeze.json`.
- Runtime amendments set the spending cap to 35 USD, transport timeouts to 300 seconds, and the per-model scheduling limits below. Judge contracts, parser behavior, models, medium reasoning, output limits, statistics and sealed order are unchanged.
- The first plugin crash interrupts six pilot calls; their 0.90 USD reservations remain uncertain. A second reconnect finds one Gemini fetch failure and three unfinished native calls. All uncertain reservations remain counted. See `runtime-recovery.json`, `runtime-recovery-2.json`, and `results/spend.jsonl`.
- The latest owner authorization permits three retries after an initial HTTP 429, with waits of 60, 120 and 240 seconds. Other transport failures allow three submissions total. Timeouts are 300 seconds. Returned model answers never receive transport retries.
- The latest pacing amendment runs all three models side by side: gpt-6-luna uses at most eight plain HTTP calls, Gemini two calls, and Haiku two calls. Each model keeps its sealed order and phase prerequisites. All queues share one spending ledger.
- This supersedes the earlier Haiku/Luna-first schedule. HTTP 429 returns no model answer and is counted separately per cell, never as a judge failure. Exhausted Gemini rate-limit recovery parks only Gemini while other models continue.
- A later owner instruction parks Gemini until prepaid credits are replenished. An observed HTTP 402 immediately stops all Gemini submissions and releases only holds for proven HTTP 402 rejections. Other interrupted holds remain uncertain; provider failures never become judge decisions.
- Two named Luna development calls exhaust three transport submissions with no answer. The owner authorizes one additional cycle of at most three submissions each after a successful connectivity probe. The exact call keys and expected unauthenticated HTTP 401 probe are in `freeze.json`; a second exhaustion remains missing and does not block the full test.
- Last-call cutoff: `2026-10-13T16:00:00Z`. The owner extends it from 13:00 to 16:00 UTC because shared Gemini quota requires model reordering. This changes no source hash, seal or spending cap; the authorization is in `freeze.json`.
- Both HTTP models use medium reasoning for every contestant and the same 4096 output-token cap. Haiku uses native Claude CLI without an exposed reasoning setting.
- The owner unblocks Gemini billing and restricts key files to `openai.key` and `gemini-driftbench.key`. Keys load inside each command and are not printed.
- Six analysis tests and twelve harness tests pass before the new pacing run. Coverage includes source tamper rejection, shared spend reservations, proven HTTP 402 hold release, transport backoff, per-model concurrency, sealed queue order, provider isolation, output polarity and the pushed-core adapter.
- All paths above are relative to `examples/ledger-wp` unless prefixed otherwise. The branch is [research/ledger-wp](https://github.com/achammah/driftbench/tree/research/ledger-wp). Remote delivery is verified separately at handoff.
