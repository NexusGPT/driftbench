# No fresh JudgeBench or RubricBench pool remains

**Research note.** This page records an audit from 2026-10-15. Zero eligible items remain in either published dataset. No paid call ran, and spend is 0 USD. Further public-benchmark work stopped. There is no new default-judge result, and no earlier TIE verdict changes. The exclusion certificate, the power calculation and their scripts are in PR 473 (branch `research/fresh-bigpools-20261015`, head `e13162fc3`).

## The pools

| Public source, pinned revision | Published items | Excluded by prior item ID | Fresh |
| --- | ---: | ---: | ---: |
| JudgeBench, GPT and Claude splits, revision `57dd5e0b9817d07f05ec8f45a91b2ce1e310e308` | 620 | 620 | 0 |
| RubricBench, train split, revision `430cfa40193d4f65998bfc63627f4b952c373e55` | 1,147 | 1,147 | 0 |

## The exclusion proof

* JudgeBench: the earlier recorded-ID list covers 349 of 350 GPT items. The earlier ledger test pool covers all 270 Claude items. The last GPT item appears in `research/moj/data/judgebench.json` as a practice item.
* RubricBench: the earlier recorded-ID list matches all 1,147 public IDs exactly. One retained Haiku recording independently contains them all.
* Every item has an ID witness in `exclusions.json`. A prepared run manifest counts as exposure. A raw public-data cache alone does not.
* Removing question overlaps cannot enlarge an empty ID-filtered pool. The populations hold 528 and 1,140 distinct normalised questions.
* This is a full-population certificate from decisive witnesses. It does not claim that every historical file was audited. Missing historical exposure can only exclude more items.

## Planning power, not a new result

The calculation uses the exact paired sign test and integrates over the number of discordant pairs. The target is 80% probability of a positive-direction rejection. The two-sided test uses the first Holm threshold, 0.05 divided by 5, for each benchmark's five peers: promptfoo, DeepEval, Inspect, Langfuse and LangWatch.

| Historical Haiku ledger proxy against promptfoo | Prior N | Wins and losses | Discordance and conditional win rate | Independent pairs needed at alpha 0.01 | Joint ten-test sensitivity at alpha 0.005 |
| --- | ---: | ---: | --- | ---: | ---: |
| JudgeBench | 270 | 27 and 11 | 0.140741 and 0.710526 | 481 | 544 |
| RubricBench | 790 | 184 and 76 | 0.329114 and 0.707692 | 211 | 239 |

* The JudgeBench accuracy difference is +5.93 percentage points.
* RubricBench uses the sign of each pair's two-order score difference. It does not treat the 1,580 presentations as independent.
* These effects belong to the benchmark-only ledger, not to the default judge. The numbers are planning proxies. They are not 80% joint power to beat all peers.
* Repeated questions need question-level sampling or clustered inference.

## What cannot be done

* The pilot of ten items per side and the full run cannot be formed.
* Unit-cost measurement and new p-values do not apply.
* No product pre-registration was committed.
