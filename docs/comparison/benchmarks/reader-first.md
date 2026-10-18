# Reader-first judge (length-aware)

An explicit opt-in configuration favors the longer reply unless machine checks and the five-criterion model rubric justify a shorter-reply exception. It remains separate from the default judge.

## Frozen DEV

Report timestamp: 2026-10-13T04:53:41.183Z. TEST checkpoint: 2026-10-13T04:48:25.497Z.

All 90 DEV pairs are covered, with 180 scored games. Each pair has two model presentations; code pools their scores, so the two reported games share one decision. Both presentations retain separate quotes and scores in the raw report.

| Variant | Correct games | Games gained vs length | Games lost vs length | USD per 100 pairs |
|---|---:|---:|---:|---:|
| Length alone | 78.89% (142/180) | 0 | 0 | 0 |
| Features plus length | 78.89% (142/180) | 0 | 0 | 0 |
| Reader-first judge (length-aware): features plus judge plus length | 80.00% (144/180) | 4 | 2 | 0.81568 |
| Frozen holistic, historical | 64.44% (116/180) | n/a | n/a | 0.57181 |

Selected rule: judgeMargin=4, minFailures=1, featureMargin=5. The final full DEV replay runs after the selection commit 7797431e936dfcc7555aac6b91ac845f98a94e3e. Freeze record cites that DEV result and the exact source hashes. The committed frozen judge is c50b2dc3f0c6c3e9bc3b82d848fb9bc1a98451c4. Current evidence commit before this report: 8e6d2cc2959d1500fec8dfcef8b777921c682779.

The shorter reply wins only when both ballots are valid, its pooled sum advantage reaches judgeMargin, and minFailures criteria have longer<=2, shorter>=3 and a machine flag present only in the longer reply. An invalid ballot retains the length default with an explicit invalid flag. Equal lengths tie. No holistic or competitor ballot enters this calculation.

## Machine feature firing on DEV

| Feature family | Reply flags | Pairs with flag | One-sided pairs | Qualifying supported failures |
|---|---:|---:|---:|---:|
| structure | 0/180 | 0/90 | 0 | 0 |
| economy | 57/180 | 41/90 | 25 | 6 |
| directness | 0/180 | 0/90 | 0 | 0 |
| context | 85/180 | 52/90 | 19 | 2 |
| simplicity | 4/180 | 4/90 | 4 | 2 |

- Length: English whitespace units, Chinese Han characters. It exactly reproduces the supplied 142/180 baseline.
- Structure: length>500, no heading/list, and one paragraph or mean paragraph length>250 English / 400 Chinese.
- Economy: filler+hedge phrases>6 per 1,000 units, duplicate sentences>0.08, or redundant four-grams>0.15.
- Directness: litotes>1 per 1,000 units.
- Context: undefined acronyms>3, unexplained dictionary jargon>3, or context-reference phrases>1 per 1,000 units.
- Simplicity: mean sentence length>35 English / 60 Chinese, or estimated English reading grade>14. Chinese has no English reading-grade estimate.

All raw feature values, including headings, lists, paragraph counts, means and densities, are retained for every reply. These are heuristic flags, not semantic proof. Requested repetition and appropriate literary forms remain legitimate under the model rubric. Invalid-evidence fallbacks: 22/90 pairs.

### DEV changes versus longer-wins

| Pair | Language | A / B length | Longer | Reader-first | Gold | Effect | Supported failures |
|---|---|---:|---|---|---|---|---|
| d3f7457d-11ad-4f02-a849-31518f5a729d:c8879d119bae | zh | 1180 / 2816 | B | A | A | gain | economy |
| 8a981764-d2ff-44a0-a3bb-78090ec8107f:301c17a7b13b | zh | 1701 / 2753 | B | A | A | gain | context |
| 43b647a6-2c1f-4f0b-95b3-da61f793802c:f227cf6be572 | en | 5187 / 813 | A | B | A | loss | context, simplicity |

### Machine-only changes versus longer-wins

| Pair | Language | A / B length | Longer | Features | Gold | Effect | Support |
|---|---|---:|---|---|---|---|---|

No decisions differ from length alone.

## Every DEV threshold variant

The grid is declared before completion of the exploratory DEV run. Selection maximizes combined DEV accuracy, then minimizes overrides, then prefers a larger judge margin and failure count. The feature-only margin is selected independently, preferring a larger margin on ties. Final DEV replay confirms the chosen rule without new calls. This is tuning on DEV, not a fresh DEV estimate.

| Judge margin | Minimum failures | DEV games correct | Override pairs | Gain pairs | Loss pairs |
|---:|---:|---:|---:|---:|---:|
| 4 | 1 | 144/180 | 3 | 2 | 1 |
| 10 | 3 | 142/180 | 0 | 0 | 0 |
| 10 | 2 | 142/180 | 0 | 0 | 0 |
| 10 | 1 | 142/180 | 0 | 0 | 0 |
| 8 | 3 | 142/180 | 0 | 0 | 0 |
| 8 | 2 | 142/180 | 0 | 0 | 0 |
| 8 | 1 | 142/180 | 0 | 0 | 0 |
| 6 | 3 | 142/180 | 0 | 0 | 0 |
| 5 | 3 | 142/180 | 0 | 0 | 0 |
| 4 | 3 | 142/180 | 0 | 0 | 0 |
| 3 | 3 | 142/180 | 0 | 0 | 0 |
| 2 | 3 | 142/180 | 0 | 0 | 0 |
| 3 | 1 | 142/180 | 4 | 2 | 2 |
| 2 | 1 | 142/180 | 4 | 2 | 2 |
| 6 | 2 | 140/180 | 1 | 0 | 1 |
| 6 | 1 | 140/180 | 1 | 0 | 1 |
| 5 | 2 | 140/180 | 1 | 0 | 1 |
| 5 | 1 | 140/180 | 1 | 0 | 1 |
| 4 | 2 | 140/180 | 1 | 0 | 1 |
| 3 | 2 | 140/180 | 1 | 0 | 1 |
| 2 | 2 | 140/180 | 1 | 0 | 1 |

| Feature margin | DEV games correct | Override pairs | Gain pairs | Loss pairs |
|---:|---:|---:|---:|---:|
| 5 | 142/180 | 0 | 0 | 0 |
| 4 | 142/180 | 0 | 0 | 0 |
| 3 | 142/180 | 0 | 0 | 0 |
| 2 | 142/180 | 2 | 1 | 1 |
| 1 | 114/180 | 18 | 2 | 16 |

## TEST confirmation

One frozen TEST run, continued once after a session-limit interruption, covers all 173 pairs and 346 games. Successful prompts replay from cache without repeat calls. The source hashes match the committed freeze. TEST never selects a threshold. Earlier studies already evaluated this split; this is confirmation on a previously evaluated split.

| Variant | Correct games | Games gained vs length | Games lost vs length | USD per 100 pairs |
|---|---:|---:|---:|---:|
| Length alone | 69.94% (242/346) | 0 | 0 | 0 |
| Features plus length | 69.94% (242/346) | 0 | 0 | 0 |
| Reader-first judge (length-aware): features plus judge plus length | 71.68% (248/346) | 6 | 0 | 0.79618 |
| Frozen holistic, historical | 58.96% (204/346) | n/a | n/a | 0.54818 |
| promptfoo, historical | 62.72% (217/346) | n/a | n/a | 0.40649 |

Combined minus holistic: 44 games. Combined minus promptfoo: 31 games. Combined minus length: 6 games. These are observed counts, not significance or general-superiority claims.

| Feature family | Reply flags | Pairs with flag | One-sided pairs | Qualifying supported failures |
|---|---:|---:|---:|---:|
| structure | 0/346 | 0/173 | 0 | 0 |
| economy | 83/346 | 55/173 | 27 | 3 |
| directness | 2/346 | 2/173 | 2 | 0 |
| context | 147/346 | 92/173 | 37 | 3 |
| simplicity | 8/346 | 7/173 | 6 | 2 |

### TEST changes versus longer-wins

| Pair | Language | A / B length | Longer | Reader-first | Gold | Effect | Supported failures |
|---|---|---:|---|---|---|---|---|
| c8156bb9-f3c1-492c-84fe-1466333c128b:374f6aace872 | zh | 746 / 3549 | B | A | A | gain | context |
| ab7b3fb5-a0f1-4c7b-a04f-68e90a175261:9ef6b2a28174 | zh | 1408 / 2826 | B | A | A | gain | context |
| 65fca3a9-6621-4162-a477-33083c83b1f4:bdb0d59fd0f1 | zh | 396 / 14334 | B | A | A | gain | economy, simplicity |

Invalid-evidence fallbacks: 74/173 pairs.

## Cost, safety and default preservation

Returned spend: USD 2.11150276, 526 returned calls. Interrupted-call uncertainty reserve: USD 0.20. Total accounted exposure: USD 2.31150276 of USD 20.00. The original two-worker process is stopped at the owner's concurrency update; its returned calls replay for free. Subsequent concurrency is at most six. The initial new-call cutoff is 2026-10-13 06:39 Brussels. The owner then authorizes immediate continuation after the 06:40 session reset, until the network drops, and another continuation after the outage with the same freeze. The continuation has a 07:40 Brussels safety deadline before the original 07:45 completion target. Recipe costs count both required orders of completed pairs, including replayed calls, and are quoted per 100 pairs (200 presentations). Unfinished orders are excluded from that recipe rate but included in returned spend.

All 42 pre-existing judge source files except the export index are byte-identical to base d702d90b. The index adds named exports. The full judges suite passes 602 tests with two test workers and a 60-second per-test timeout; the focused golden and configuration run passes 41 tests, including 1,028 legacy cassette entries. The new reader-first fixtures pass 20 tests. Root and research TypeScript checks pass. The package and its workspace dependencies build successfully, including type declarations; the built package export smoke check passes. A first package-only build fails because dependency declarations are not built, then the dependency-inclusive build resolves it. Two runs with the default five-second timeout time out during a dynamic import in an unchanged pairwise test; the run with a 60-second timeout passes without a code change. All nine caller cutoff and cost tests pass using fake processes, with no paid calls. After TEST completes, the single formatter correction is applied. The measured source remains at its frozen commit; format-only-proof.json verifies an identical emitted JavaScript syntax tree. All 20 reader-first fixture tests pass again, and the targeted Biome check exits successfully with warnings only.

The package API is createReaderFirstJudge(client, { configuration: 'reader-first' }). It is never selected automatically. The doc section is docs/concepts/judges.md. Default source hashes are in results/default-proof.json. Rules and source provenance are in README.md; each criterion's source quotes, scores, machine measurements and decisions are in results/final-dev.json and results/test.json when present. Raw responses are in recordings/haiku.jsonl. One approved benchmark contact is consistently replaced in loaded candidates, recordings and exports; see comparisons/reader-first/recordings/REDACTION.md. Other public benchmark contacts retain their scoped guard annotations. Model-generated punctuation in raw evidence is preserved.

Historical baselines are supplied by the prior holistic and protocol reports. Length bias is deliberately used here. A better score on these labels does not establish better writing evaluation elsewhere. No default row is merged with this configuration.
