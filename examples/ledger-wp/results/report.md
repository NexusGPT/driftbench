# LongJudge writing pair ledger study

Measured state: 2026-10-13T07:35:43.368707+00:00. Branch `research/ledger-wp`, local head `a4ae4b3327a2e5148f97a47707aed3a0b865da50`.

## Outcome

The model table below is the observed result, including pending and partial cells. No global superiority claim is made. This row is preregistered as no significant loss, not an assumed win.

Actual recorded model spend: 0.98377766 USD. Unsettled reservations: 1.05000000 USD. Total lane cap: 15 USD. Returned calls: 225. Source: `results/spend.jsonl` and `results/calls.jsonl`.

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

| Model | Contestant | Pairs / 173 | Correct games | Accuracy % | Wilson 95% | Errors | USD / 100 pairs |
|---|---|---:|---:|---:|---|---:|---:|
| haiku | pair-ledger | 0 | 0/0 | pending | pending | 0 | pending |
| haiku | reader-first-c50b2dc3 | 0 | 0/0 | pending | pending | 0 | pending |
| haiku | promptfoo | 0 | 0/0 | pending | pending | 0 | pending |
| gpt-6-luna | pair-ledger | 0 | 0/0 | pending | pending | 0 | pending |
| gpt-6-luna | reader-first-c50b2dc3 | 0 | 0/0 | pending | pending | 0 | pending |
| gpt-6-luna | promptfoo | 0 | 0/0 | pending | pending | 0 | pending |
| gemini-3.8-flash | pair-ledger | 0 | 0/0 | pending | pending | 0 | pending |
| gemini-3.8-flash | reader-first-c50b2dc3 | 0 | 0/0 | pending | pending | 0 | pending |
| gemini-3.8-flash | promptfoo | 0 | 0/0 | pending | pending | 0 | pending |

Reader-first is the separate opt-in PR 157 row at `c50b2dc3`. It has a length prior and a defect-gated override. It is not included in the primary pair-ledger family. Both its games share one normalized decision; pair-ledger reconciliation does the same. Raw readings remain in `results/decisions.jsonl`.

| Model | Challenger vs promptfoo | Matched pairs | Wins / losses | Difference, points | Request-cluster 95% | Exact two-sided p | Holm-18 |
|---|---|---:|---:|---:|---|---:|---|
| haiku | pair-ledger | 0 | 0/0 | pending | pending | pending | pending full primary family |
| haiku | reader-first-c50b2dc3 | 0 | 0/0 | pending | pending | pending | pending full primary family |
| gpt-6-luna | pair-ledger | 0 | 0/0 | pending | pending | pending | pending full primary family |
| gpt-6-luna | reader-first-c50b2dc3 | 0 | 0/0 | pending | pending | pending | pending full primary family |
| gemini-3.8-flash | pair-ledger | 0 | 0/0 | pending | pending | pending | pending full primary family |
| gemini-3.8-flash | reader-first-c50b2dc3 | 0 | 0/0 | pending | pending | pending | pending full primary family |

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
| pilot | haiku | pair-ledger | 11 | 63.64 | 0.9471 | pending/pending | pending | pending |
| pilot | haiku | reader-first-c50b2dc3 | 11 | 63.64 | 1.2288 | pending/pending | pending | pending |
| pilot | haiku | promptfoo | 11 | 72.73 | 0.5623 | pending/pending | pending | pending |
| pilot | gpt-6-luna | pair-ledger | 11 | 81.82 | 0.3473 | pending/pending | pending | pending |
| pilot | gpt-6-luna | reader-first-c50b2dc3 | 11 | 63.64 | 0.5147 | pending/pending | pending | pending |
| pilot | gpt-6-luna | promptfoo | 11 | 59.09 | 0.1843 | pending/pending | pending | pending |
| pilot | gemini-3.8-flash | pair-ledger | 11 | 72.73 | 2.8395 | pending/pending | pending | pending |
| pilot | gemini-3.8-flash | reader-first-c50b2dc3 | 10 | 60.00 | 5.2714 | pending/pending | pending | pending |
| pilot | gemini-3.8-flash | promptfoo | 11 | 81.82 | 2.0821 | pending/pending | pending | pending |
| dev | haiku | pair-ledger | 0 | pending | pending | 0/0 | False | False |
| dev | haiku | reader-first-c50b2dc3 | 0 | pending | pending | 0/0 | False | False |
| dev | haiku | promptfoo | 0 | pending | pending | 0/0 | False | False |
| dev | gpt-6-luna | pair-ledger | 0 | pending | pending | 0/0 | False | False |
| dev | gpt-6-luna | reader-first-c50b2dc3 | 0 | pending | pending | 0/0 | False | False |
| dev | gpt-6-luna | promptfoo | 0 | pending | pending | 0/0 | False | False |
| dev | gemini-3.8-flash | pair-ledger | 0 | pending | pending | 0/0 | False | False |
| dev | gemini-3.8-flash | reader-first-c50b2dc3 | 0 | pending | pending | 0/0 | False | False |
| dev | gemini-3.8-flash | promptfoo | 0 | pending | pending | 0/0 | False | False |

Detailed three-repeat noise, six planted fixtures, kappa, label-preserving, injection and label-flipping checks: `results/phase-report.json`. Unrun checks are pending, not passed. Source and parser remain frozen; no tuning follows these observations.

## Freeze and execution

- Core: [PR 168](https://github.com/achammah/driftbench/pull/168), `2bb0a7a787ca4466ff69d204f2380a7ad19cc056`, remote hash verified before calls.
- Reader-first: [PR 157](https://github.com/achammah/driftbench/pull/157), source snapshot `c50b2dc3`.
- Promptfoo select-best: `801428268b5e421b2f6994332f6a06f86b27bb1f`, verbatim attributed template and MIT notice.
- Source freeze commit: `a4ae4b33`. Freeze SHA-256: `1fb32801af8549c7a4bef7a6c271c1799e950a84316e9fcb027ef757a36b3682`. The 191 exact file hashes are in `freeze.json`.
- Both HTTP models use medium reasoning for every contestant and the same 4096 output-token cap. Haiku uses native Claude CLI without an exposed reasoning setting.
- The owner unblocks Gemini billing and restricts key files to `openai.key` and `gemini-driftbench.key`. Keys load inside each command and are not printed.
- Six analysis tests and seven harness tests pass before calls, including source tamper rejection, concurrent spend reservation, output polarity and the pushed-core adapter.
- All paths above are relative to `examples/ledger-wp` unless prefixed otherwise. The branch is [research/ledger-wp](https://github.com/achammah/driftbench/tree/research/ledger-wp). Remote delivery is verified separately at handoff.
