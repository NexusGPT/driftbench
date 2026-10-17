# Phase 4: Jev and Haiku on the answer key without Haiku, the default two-class stack, and a fixed rubric

Date 2026-10-17. Branch `research/jev-id-experiments`. Every number below comes from a recorded run; the file or run id sits next to it. Replay: `JEV_MODE=replay`, cassettes `cassette4.jsonl.gz`, `cassette4-haiku.jsonl.gz`, `cassette2b.jsonl.gz`, `cassette2b-haiku.jsonl.gz` (all checked for key leaks before writing). One fictional estate is one estate: the intervals treat the units as independent, and they are not (they sit in 9 files), so every interval is optimistic.

## Headline

- **Answer key without Haiku** = the 465 of 566 span-corpus units where annotator A (author) and annotator C (Opus) give the same label. Annotators agree on 82.2% of the 566 units (kappa 0.774, `agree4.out.md`). The key leaves out the 101 units where two readers differ: it is the easier part of the set, so all key accuracies are higher than they would be on the full set (full-set columns are beside them).
- **Jev alone, best design**: native `choice` question, structured window of 30 units, calibrated head with probes, pair answers, structure and neighbours: **82.2% [78.4, 85.4]** at 0% unsure, **87.4%** at 10% unsure. Without calibration: 80.0% [76.1, 83.4]. The earlier yes/no design: 71.8% [67.6, 75.7]. At equal settings (whole-file flat window, same definitions) the type switch alone is 71.8 to 75.1% (`an22.out.md`); the rest of the gain comes from the window of 30 and from showing structure.
- **Haiku alone**: one run 90.5 / 91.0 / 91.8%; majority of 3: **91.4% [88.5, 93.6]**; accepted only when unanimous: 95.3% [92.8, 96.9] on 90.8% of units.
- **Jev does not beat Haiku on accuracy on this key.** The gap on the 0% column is 9 points; the intervals do not overlap.
- **Default stack** (`STACK-SPEC.md`): Jev head first, the lowest-margin share to Haiku (3 runs), unanimous Haiku accepted, otherwise a person. At the 95%-target cut (margin 0.65, 40% to Haiku): 93.5% [90.8, 95.5] on accepted, 6.7% to a person (Table 5). A real run of the cascade (Haiku only on the sent units) gives 93.1% / 6.7% at cut 0.67 and 92.9% / 6.2% at cut 0.76 (Table 7).
- **The cascade does not save money or Haiku time against Haiku alone (3 runs)** at this task size: USD 0.0156 to 0.0170 per 100 units against 0.0118, because the Jev head costs 0.0057 and Haiku still reads the whole file (Table 7). Where Jev pays is speed on the confident half (cut 0.76: 44% of test units labelled by Jev alone at 99.3% [96.1, 99.9], in about 3.6 s per 100 units) and as an independent second opinion (Jev and a unanimous Haiku agree: 97.0% [94.7, 98.3] on 79.4% of units).
- **Rubric fix worked.** Disagreement between two annotators on the 597-unit harbour set falls from 9.5% (kappa 0.870) to 5.0% (kappa 0.934) after guide 2.1 (Part II). Haiku as labeller rises from 92.1% to 95.8% on the new gold. Caveat in Part II: the rules were written after reading these units' disagreements, and two of the three annotators behind the new gold are Haiku runs.
- **99% is not reached by any measured design.** Best: Haiku unanimous, 97.5% on 94.5% of the harbour set; Jev head + Haiku votes at 20% unsure, 98.7% (Part II). On the span-corpus key: 96.2% at 20% unsure.

## What 99% means from now on (the lead's three measures)

| Measure | Result | Source |
|---|---|---|
| (a) A rule is present, any overlap, span corpus (174 gold rules, 9 files) | Haiku runs 97.7%; Jev head with pair head 95.4% | `tables4-spans-J1.md`, "Any-overlap R", all 9 files |
| (b) Per-unit label, units the two annotators agree on | Jev head 82.2%; Haiku majority 91.4% | Table 1 |
| (c) Per-unit label on accepted units, share sent to a person | See Table 5: 95.1% with 7.5% to a person (50% of units to Haiku); 97.0% with 20.6% to a person (agreement rule) | Table 5 and "Other mixes" |
| Exact span edges (reported, not gated) | Haiku consensus 80.9 F1, Jev head + pair head 64.6 F1, all 9 files; two annotators agree exactly on 123 of 173 and 190 rules | `tables4-spans-J1.md`, `agree4.out.md` |

## Part I. Jev against Haiku on the answer key

Designs and files: `src/p4.ts` (designs), `heads4.ts` (heads), `tables4.ts` (Tables 1 to 6), `run4.sh` (live driver, sequential). Jev price USD 0.042 per million input tokens, output free (owner, 17 October 2026; the same screenshot also says "around 0.25 per million" on volume packs, which contradicts it, so 0.042 is used). Haiku price USD 0.10 per million input and 0.50 per million output, derived from receipts. Calls were sequential, so seconds per call are clean for both. Jev model `jev-latest` (answers as `jev-1.13.0`) unless stated.

#### Table 1. Per-unit label accuracy on the answer key (units where A and C agree)

Accuracy % with the Wilson 95% interval in brackets. "10% unsure" holds back the 10% of units with the lowest confidence (for Jev: the gap between the two most likely labels). Units are not independent (they sit in 9 files), so the intervals are optimistic.

| Design | 0% unsure, key (n = 465) | 10% unsure, key | 0% unsure, test files only (n = 317) | 0% unsure, full adjudicated set (n = 566) |
|---|---|---|---|---|
| Jev raw, 5 yes/no questions per unit, file window (phase 1 to 3 style) | 71.8 [67.6, 75.7] | 74.9 [70.6, 78.9] | 72.9 [67.7, 77.5] | 65.9 [61.9, 69.7] |
| Jev raw, 1 choice question per unit, window of 30 units (S) | 80.0 [76.1, 83.4] | 83.8 [79.9, 87.0] | 82.0 [77.4, 85.9] | 72.6 [68.8, 76.1] |
| Jev raw, same, mean of 3 passes | 80.0 [76.1, 83.4] | 83.1 [79.2, 86.3] | 82.3 [77.8, 86.1] | 72.4 [68.6, 76.0] |
| Jev raw, choice, whole-file window (L) | 78.3 [74.3, 81.8] | 81.4 [77.4, 84.8] | 79.5 [74.7, 83.6] | 71.0 [67.2, 74.6] |
| Jev raw, choice, one unit per call with its block and neighbours | 81.1 [77.3, 84.4] | 83.8 [79.9, 87.0] | 83.3 [78.8, 87.0] | 73.5 [69.7, 77.0] |
| Jev raw, two levels: instruction or not, then the kind (file window) | 79.8 [75.9, 83.2] | 83.3 [79.4, 86.6] | 82.0 [77.4, 85.9] | 72.8 [69.0, 76.3] |
| Jev raw, paraphrase average: 3 wordings of the definitions (file window, 1 pass each) | 78.1 [74.1, 81.6] | 81.9 [77.9, 85.3] | 79.5 [74.7, 83.6] | 71.2 [67.3, 74.8] |
| Jev raw, choice, window of 30 units, model jev-preview | 80.4 [76.6, 83.8] | 83.8 [79.9, 87.0] | 82.0 [77.4, 85.9] | 73.3 [69.5, 76.8] |
| one choice design, calibrated (1 pass) | 79.8 [75.9, 83.2] | 84.7 [81.0, 87.9] | 82.3 [77.8, 86.1] | 73.7 [69.9, 77.1] |
| J*: two choice windows + probes + pair answers + structure + neighbours (1 pass each) | 82.2 [78.4, 85.4] | 87.4 [83.8, 90.2] | 81.4 [76.7, 85.3] | 76.0 [72.3, 79.3] |
| J*: the same, 2 to 3 passes averaged | 82.2 [78.4, 85.4] | 87.1 [83.6, 90.0] | 81.7 [77.1, 85.6] | 75.8 [72.1, 79.1] |
| S4 + probes (3 passes; probes 2) | 84.5 [80.9, 87.5] | 87.4 [83.8, 90.2] | 83.9 [79.5, 87.5] | 77.9 [74.3, 81.1] |
| J* (1 pass) trained on Haiku majority labels instead of the key | 82.8 [79.1, 86.0] | 86.2 [82.5, 89.1] | 82.6 [78.1, 86.4] | 74.4 [70.6, 77.8] |
| Haiku, run 1 (one run, no unsure signal) | 90.5 [87.5, 92.9] | 90.2 [87.0, 92.7] | 88.3 [84.3, 91.4] | 83.0 [79.7, 85.9] |
| Haiku, run 2 (one run, no unsure signal) | 91.0 [88.0, 93.2] | 90.5 [87.3, 92.9] | 90.9 [87.2, 93.6] | 83.9 [80.7, 86.7] |
| Haiku, run 3 (one run, no unsure signal) | 91.8 [89.0, 94.0] | 91.6 [88.6, 93.9] | 91.2 [87.5, 93.8] | 86.6 [83.5, 89.1] |
| Haiku, majority of 3 runs (unsure = the runs are not unanimous) | 91.4 [88.5, 93.6] | 95.2 [92.7, 96.9] | 89.9 [86.1, 92.8] | 85.5 [82.4, 88.2] |
| J* (1 pass) + the votes of 3 Haiku runs, one head | 91.4 [88.5, 93.6] | 94.5 [91.9, 96.3] | 91.2 [87.5, 93.8] | 84.5 [81.2, 87.2] |

Haiku majority of 3: the 3 runs are not unanimous on 43 of 465 key units (9.2%). On the 422 units where they are unanimous the accuracy is 95.3 [92.8, 96.9].

#### Table 2. Efficiency per 100 units

All Jev calls are sequential (one at a time), so "seconds per call" is clean. Haiku runs were sequential too, one call per file. Jev price: USD 0.042 per million input tokens, output free (owner, 17 October 2026, from a screenshot of a pricing answer; the same screenshot mentions "around 0.25 per million" on volume packs, which contradicts it; 0.042 is used). Haiku price: derived from our receipts, USD 0.10 per million input and 0.50 per million output tokens. Seconds per 100 units is the sum of the call times for the design, one call after the other.

| Design | Calls | Input tokens | Output tokens | Median s per call | 90th percentile s per call | Seconds per 100 units | USD per 100 units |
|---|---|---|---|---|---|---|---|
| Jev raw, 5 yes/no questions per unit, file window (phase 1 to 3 style) | 1.6 | 25.4k | 10.7k | 0.36 | 0.46 | 0.6 | 0.0011 |
| Jev raw, 1 choice question per unit, window of 30 units (S) | 3.7 | 23.0k | 6.2k | 0.26 | 0.30 | 1.0 | 0.0010 |
| Jev raw, same, mean of 3 passes | 11.1 | 68.9k | 18.7k | 0.25 | 0.29 | 2.8 | 0.0029 |
| Jev raw, choice, whole-file window (L) | 1.6 | 22.4k | 6.2k | 0.30 | 0.32 | 0.5 | 0.0009 |
| Jev raw, choice, one unit per call with its block and neighbours | 100.0 | 63.0k | 6.5k | 0.20 | 0.27 | 21.8 | 0.0026 |
| Jev raw, two levels: instruction or not, then the kind (file window) | 3.2 | 25.6k | 6.6k | 0.26 | 0.31 | 0.8 | 0.0011 |
| Jev raw, paraphrase average: 3 wordings of the definitions (file window, 1 pass each) | 4.8 | 68.8k | 18.6k | 0.29 | 0.35 | 1.5 | 0.0029 |
| Jev raw, choice, window of 30 units, model jev-preview | 3.7 | 23.0k | 6.2k | 0.26 | 0.28 | 1.0 | 0.0010 |
| one choice design, calibrated (1 pass) | 3.7 | 23.0k | 6.2k | 0.26 | 0.30 | 1.0 | 0.0010 |
| J*: two choice windows + probes + pair answers + structure + neighbours (1 pass each) | 10.6 | 136.1k | 67.5k | 0.31 | 0.49 | 3.6 | 0.0057 |
| J*: the same, 2 to 3 passes averaged | 28.1 | 336.5k | 151.5k | 0.29 | 0.42 | 8.8 | 0.0141 |
| S4 + probes (3 passes; probes 2) | 39.8 | 479.7k | 189.9k | 0.28 | 0.42 | 12.3 | 0.0201 |
| J* (1 pass) trained on Haiku majority labels instead of the key | 10.6 | 136.1k | 67.5k | 0.31 | 0.49 | 3.6 | 0.0057 |
| Haiku, run 1 (one run, no unsure signal) | 1.6 | 4.4k | 7.3k | 19.46 | 22.38 | 31.3 | 0.0041 |
| Haiku, run 2 (one run, no unsure signal) | 1.6 | 4.4k | 6.5k | 14.84 | 20.93 | 27.5 | 0.0037 |
| Haiku, run 3 (one run, no unsure signal) | 1.6 | 4.4k | 7.1k | 16.93 | 23.19 | 30.8 | 0.0040 |
| Haiku, majority of 3 runs (unsure = the runs are not unanimous) | 4.8 | 13.3k | 21.0k | 18.59 | 23.19 | 89.6 | 0.0118 |
| J* (1 pass) + the votes of 3 Haiku runs, one head | 10.6 | 136.1k | 67.5k | 0.31 | 0.49 | 3.6 | 0.0057 |

#### Table 3. Batch size: one choice question per unit, key accuracy of one pass

| Window | Where the definitions are | Questions in the largest call | Accuracy % [Wilson 95%] | 10% unsure | Calls per 100 units | Input tokens per 100 units | Seconds per 100 units |
|---|---|---|---|---|---|---|---|
| one unit per call, with its block and the blocks around it | in criteria | 1 | 81.1 [77.3, 84.4] | 83.8 | 100.0 | 63.0k | 21.8 |
| about 30 units per call (21 calls for 566 units) | in criteria | 39 | 80.0 [76.1, 83.4] | 83.8 | 3.7 | 23.0k | 1.0 |
| one file per call (up to 86 units) | in criteria | 86 | 78.3 [74.3, 81.8] | 81.4 | 1.6 | 22.4k | 0.5 |
| about 140 units per call (4 calls) | in criteria | 149 | 76.1 [72.1, 79.8] | 80.0 | 0.7 | 22.1k | 0.3 |
| one file per call | once in the state | 86 | 70.8 [66.5, 74.7] | 74.7 | 1.6 | 9.8k | 0.4 |
| one file per call | the annotators' guide once in the state | 86 | 73.5 [69.4, 77.4] | 77.3 | 1.6 | 10.1k | 0.4 |
| about 300 units per call (2 calls) | the annotators' guide once in the state | 301 | 67.5 [63.1, 71.6] | 70.9 | 0.4 | 9.4k | 0.2 |
| all 566 units in one call | the annotators' guide once in the state | 566 | 64.5 [60.1, 68.7] | 68.0 | 0.2 | 9.2k | 0.2 |
| all 566 units in one call, flat window (no structure shown) | once in the state | 566 | 69.9 [65.6, 73.9] | 73.0 | 0.2 | 9.1k | 0.1 |
| about 30 units per call | the annotators' definitions in criteria | 39 | 78.1 [74.1, 81.6] | 81.6 | 3.7 | 38.6k | 1.1 |
| about 30 units per call | definitions plus 3 invented examples per option in criteria | 39 | 78.3 [74.3, 81.8] | 81.4 | 3.7 | 56.3k | 1.2 |
| about 30 units per call, flat window (no structure shown) | in criteria | 30 | 77.6 [73.6, 81.2] | 81.9 | 3.7 | 22.9k | 1.0 |

#### Table 4. Calibrated heads over Jev answers (leave one file out, trained on the key labels of the other files)

Accuracy % on the key at 0%, 10%, 30% and 50% unsure, with Wilson 95% bounds; the last two columns split the 0% figure by position in a multi-unit rule.

| Head | 0% | 10% | 30% | 50% | Outside multi-unit rules | Inside multi-unit rules |
|---|---|---|---|---|---|---|
| one choice design, calibrated (1 pass) | 79.8 [75.9, 83.2] | 84.7 [81.0, 87.9] | 90.2 [86.5, 93.0] | 92.7 [88.6, 95.4] | 89.9 [86.2, 92.6] | 53.8 [45.3, 62.2] |
| one choice design + structure, calibrated (1 pass) | 78.1 [74.1, 81.6] | 83.1 [79.2, 86.3] | 90.8 [87.2, 93.5] | 94.4 [90.7, 96.7] | 88.1 [84.1, 91.1] | 52.3 [43.8, 60.7] |
| J*: two choice windows + probes + pair answers + structure + neighbours (1 pass each) | 82.2 [78.4, 85.4] | 87.4 [83.8, 90.2] | 94.5 [91.4, 96.5] | 98.3 [95.7, 99.3] | 89.3 [85.5, 92.1] | 63.8 [55.3, 71.6] |
| J*: the same, 2 to 3 passes averaged | 82.2 [78.4, 85.4] | 87.1 [83.6, 90.0] | 94.2 [91.1, 96.2] | 97.9 [95.1, 99.1] | 89.6 [85.8, 92.4] | 63.1 [54.5, 70.9] |
| four choice designs + pair answers + structure + neighbours (3 passes) | 81.9 [78.2, 85.2] | 86.9 [83.3, 89.8] | 94.8 [91.8, 96.7] | 97.9 [95.1, 99.1] | 89.9 [86.2, 92.6] | 61.5 [53.0, 69.5] |
| S4 + probes (3 passes; probes 2) | 84.5 [80.9, 87.5] | 87.4 [83.8, 90.2] | 95.1 [92.2, 97.0] | 98.3 [95.7, 99.3] | 91.3 [87.8, 93.9] | 66.9 [58.5, 74.4] |
| J* (1 pass) + the votes of 3 Haiku runs, one head | 91.4 [88.5, 93.6] | 94.5 [91.9, 96.3] | 98.5 [96.5, 99.3] | 100.0 [98.4, 100.0] | 94.9 [92.0, 96.8] | 82.3 [74.8, 87.9] |
| J* (1 pass) trained on Haiku majority labels instead of the key | 82.8 [79.1, 86.0] | 86.2 [82.5, 89.1] | 92.3 [88.9, 94.8] | 94.4 [90.7, 96.7] | 88.7 [84.8, 91.6] | 67.7 [59.2, 75.1] |

#### Table 5. Jev first, Haiku second: operating points on the key

The Jev head J* (row "J*, 1 pass" of Table 4) ranks the units by confidence. The lowest-confidence share goes to Haiku (3 runs). Haiku's answer is taken only if the 3 runs are unanimous; otherwise the unit is "unsure" and goes to a person. Haiku cost: the full input of every call (guide and file) plus the output for the share sent; time scales with the output. These are estimates computed from the recorded full runs, not new calls.

| Share sent to Haiku | Margin cut | Accepted units | Accuracy on accepted % [Wilson 95%] | Unsure (to a person) % | USD per 100 units | Seconds per 100 units (Jev + Haiku runs one after the other) |
|---|---|---|---|---|---|---|
| 0% | 0.00 | 465 | 82.2 [78.4, 85.4] | 0.0 | 0.0070 | 3.6 |
| 10% | 0.16 | 453 | 87.9 [84.5, 90.6] | 2.6 | 0.0081 | 12.6 |
| 20% | 0.31 | 449 | 90.0 [86.9, 92.4] | 3.4 | 0.0091 | 21.6 |
| 30% | 0.49 | 441 | 92.5 [89.7, 94.6] | 5.2 | 0.0102 | 30.5 |
| 40% | 0.65 | 434 | 93.5 [90.8, 95.5] | 6.7 | 0.0112 | 39.5 |
| 50% | 0.73 | 430 | 95.1 [92.6, 96.8] | 7.5 | 0.0123 | 48.4 |
| 60% | 0.81 | 427 | 95.8 [93.4, 97.3] | 8.2 | 0.0133 | 57.4 |
| 80% | 0.92 | 424 | 95.3 [92.8, 96.9] | 8.8 | 0.0154 | 75.3 |
| 100% | 0.99 | 422 | 95.3 [92.8, 96.9] | 9.2 | 0.0175 | 93.2 |

#### Threshold chosen on the dev files, applied to the test files

The margin cut is the lowest one at which the Jev-accepted dev units reach the target accuracy; it is then applied unchanged to the test files (317 key units).

| Target accuracy of Jev-accepted units (dev) | Margin cut | Dev: share kept by Jev, accuracy | Test: share kept by Jev | Test: accuracy of Jev-accepted | Test: share sent to Haiku | Test: accuracy after Haiku (accepted) [Wilson 95%] | Test: unsure % |
|---|---|---|---|---|---|---|---|
| 95% | 0.67 | 61%, 95.6% | 57% | 97.8 [94.4, 99.1] | 43% | 93.5 [90.1, 95.8] | 7.9 |
| 97% | 0.69 | 57%, 97.6% | 53% | 98.2 [94.9, 99.4] | 47% | 93.8 [90.5, 96.1] | 7.9 |
| 98% | 0.76 | 53%, 98.7% | 44% | 99.3 [96.1, 99.9] | 56% | 94.5 [91.3, 96.6] | 8.2 |
| 99% | 0.80 | 47%, 100.0% | 38% | 99.2 [95.4, 99.9] | 62% | 94.5 [91.2, 96.6] | 8.5 |

#### Other mixes

| Mix | Accepted units | Accuracy % [Wilson 95%] | Unsure % |
|---|---|---|---|
| Haiku (3 runs) first; where the runs disagree, the Jev head decides if its margin is at least (never) | 422 | 95.3 [92.8, 96.9] | 9.2 |
| Haiku (3 runs) first; where the runs disagree, the Jev head decides if its margin is at least 0.9 | 424 | 95.3 [92.8, 96.9] | 8.8 |
| Haiku (3 runs) first; where the runs disagree, the Jev head decides if its margin is at least 0.7 | 431 | 94.7 [92.1, 96.4] | 7.3 |
| Haiku (3 runs) first; where the runs disagree, the Jev head decides if its margin is at least 0.5 | 441 | 93.7 [91.0, 95.6] | 5.2 |
| Haiku (3 runs) first; where the runs disagree, the Jev head decides if its margin is at least 0.3 | 449 | 92.4 [89.6, 94.5] | 3.4 |
| Accept only if the Jev head and the Haiku majority give the same label | 389 | 94.6 [91.9, 96.4] | 16.3 |
| Accept only if the Jev head and a unanimous Haiku give the same label | 369 | 97.0 [94.7, 98.3] | 20.6 |
| One head over the Jev answers and the 3 Haiku votes, 0% unsure | 465 | 91.4 [88.5, 93.6] | 0.0 |
| One head over the Jev answers and the 3 Haiku votes, 10% unsure | 419 | 94.5 [91.9, 96.3] | 10.0 |
| One head over the Jev answers and the 3 Haiku votes, 15% unsure | 395 | 95.9 [93.5, 97.5] | 15.0 |
| One head over the Jev answers and the 3 Haiku votes, 20% unsure | 372 | 96.2 [93.8, 97.7] | 20.0 |

#### Table 6. Where the labels go wrong (key units)

**Jev head J* (1 pass)** (rows: key label; columns: predicted)

| key \ predicted | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 92 | 5 | 9 | 1 | 6 | 2 | 80.0 |
| prohibition | 9 | 48 | 0 | 1 | 7 | 0 | 73.8 |
| gate | 15 | 1 | 17 | 1 | 2 | 0 | 47.2 |
| example | 1 | 0 | 0 | 15 | 1 | 0 | 88.2 |
| description | 12 | 6 | 0 | 0 | 107 | 3 | 83.6 |
| none | 0 | 0 | 0 | 0 | 1 | 103 | 99.0 |

**Jev raw, choice, window of 30 units, 1 pass** (rows: key label; columns: predicted)

| key \ predicted | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 97 | 0 | 0 | 3 | 7 | 8 | 84.3 |
| prohibition | 18 | 39 | 0 | 3 | 4 | 1 | 60.0 |
| gate | 21 | 1 | 11 | 1 | 2 | 0 | 30.6 |
| example | 0 | 0 | 0 | 17 | 0 | 0 | 100.0 |
| description | 12 | 5 | 0 | 0 | 105 | 6 | 82.0 |
| none | 1 | 0 | 0 | 0 | 0 | 103 | 99.0 |

**Haiku majority of 3** (rows: key label; columns: predicted)

| key \ predicted | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 112 | 2 | 0 | 0 | 1 | 0 | 97.4 |
| prohibition | 5 | 60 | 0 | 0 | 0 | 0 | 92.3 |
| gate | 15 | 0 | 21 | 0 | 0 | 0 | 58.3 |
| example | 0 | 0 | 0 | 17 | 0 | 0 | 100.0 |
| description | 14 | 1 | 0 | 0 | 112 | 1 | 87.5 |
| none | 0 | 0 | 0 | 0 | 1 | 103 | 99.0 |

Accuracy by the kind of unit (key; J* against Haiku majority):

| Kind of unit | Key units | Jev head J* | Haiku majority of 3 |
|---|---|---|---|
| sentence | 285 | 83.2 [78.4, 87.1] | 90.2 [86.2, 93.1] |
| heading | 63 | 100.0 [94.3, 100.0] | 100.0 [94.3, 100.0] |
| list_item | 45 | 60.0 [45.5, 73.0] | 82.2 [68.7, 90.7] |
| table cell, last column | 24 | 91.7 [74.2, 97.7] | 95.8 [79.8, 99.3] |
| table cell, first column | 23 | 65.2 [44.9, 81.2] | 95.7 [79.0, 99.2] |
| table cell, middle column | 15 | 66.7 [41.7, 84.8] | 93.3 [70.2, 98.8] |
| front_matter_value | 9 | 77.8 [45.3, 93.7] | 88.9 [56.5, 98.0] |
| block_quote | 1 | 100.0 [20.7, 100.0] | 100.0 [20.7, 100.0] |
| inside a multi-unit rule | 130 | 63.8 [55.3, 71.6] | 85.4 [78.3, 90.4] |
| outside multi-unit rules | 335 | 89.3 [85.5, 92.1] | 93.7 [90.6, 95.9] |

Who is right when the Jev head J* and Haiku (majority of 3) differ (key units):

They differ on 76 of 465 units: Jev is right on 14, Haiku on 57, neither on 5.

The 15 most confident wrong answers of the Jev head J* (key units):

| Unit (file#number) | Key label | Jev head | Margin | Haiku majority | Text |
|---|---|---|---|---|---|
| parts-and-donations-notes.md#9 | rule | description | 0.83 | rule | A visitor asks for a part we may have. |
| mains-safety-skill.md#26 | prohibition | description | 0.80 | prohibition | An overloaded lead |
| mains-safety-skill.md#35 | gate | description | 0.74 | rule | Stay with the person until the first aider arrives. |
| booking-tool-reference.md#45 | description | rule | 0.73 | description | Reading the whole month to find one number wastes the visitor's time. |
| session-lead-handbook.md#30 | description | prohibition | 0.70 | description | Tinker is never asked about money in the tin. |
| booking-tool-reference.md#37 | description | rule | 0.69 | description | open → the session runs as printed |
| mains-safety-skill.md#34 | gate | rule | 0.69 | rule | Then send the first aider's name to the nearest volunteer and say where the person is. |
| mains-safety-skill.md#23 | rule | description | 0.67 | rule | An overheated part |
| mains-safety-skill.md#30 | prohibition | rule | 0.66 | prohibition | Reset it once only, and only the session lead resets it |
| standing-instructions.md#41 | description | prohibition | 0.66 | description | The volunteers have a standing rule about it, and no volunteer will overrule it on the day |
| mains-safety-skill.md#29 | prohibition | description | 0.66 | prohibition | A fault somewhere on the bench |
| rota-writer-helper.md#35 | prohibition | rule | 0.64 | prohibition | Name the session lead on all three. |
| repair-ticket-skill.md#37 | prohibition | rule | 0.61 | prohibition | Item arrives with no visitor → do not make a ticket, put it on the shelf marked "waiting"  |
| mains-safety-skill.md#25 | prohibition | description | 0.60 | prohibition | Warm cable |
| rota-writer-helper.md#44 | gate | prohibition | 0.58 | rule | No volunteer appears twice in one slot |

### Table 7. The real cascade: Haiku run only on the sent units (`an21.ts`, `results4/haiku-subset-*`)

Same J* head as Table 5. Haiku was asked to label only the units below the cut (the whole file is still in its context), 3 runs, unanimous accepted. Tokens and seconds come from the recorded calls (`cassette4-haiku.jsonl.gz`). USD = Haiku tokens at the derived prices plus 0.0057 for the Jev head.

| Margin cut | Units sent to Haiku | Accuracy on accepted, key [Wilson 95%] | Unsure % (key) | Accuracy on accepted, full adjudicated set | Unsure % (full) | Haiku input / output tokens per 100 units (3 runs) | Haiku wall s per 100 units (3 runs, sequential) | USD per 100 units (Jev head + Haiku) | Haiku share of units: Jev-accepted accuracy (key) |
|---|---|---|---|---|---|---|---|---|---|
| 0.67 | 261 of 566 (46%) | 93.1 [90.3, 95.1] | 6.7 | 86.8 [83.6, 89.4] | 8.0 | 13.8k / 17.1k | 78.1 | 0.0156 | 97.0 [94.2, 98.5] (269 key units) |
| 0.76 | 337 of 566 (60%) | 92.9 [90.1, 94.9] | 6.2 | 85.6 [82.3, 88.3] | 6.9 | 13.9k / 19.8k | 88.5 | 0.0170 | 99.1 [96.7, 99.7] (214 key units) |

For comparison, Haiku on every unit, 3 runs: 13.3k input and 21.0k output tokens per 100 units, 89.6 s, USD 0.0118 (Table 2). Sending 46% to 60% of the units cut Haiku output tokens by 6% to 19% and input tokens not at all. About 92% of Haiku's output tokens are hidden thinking (measured in phase 4), which is why the output does not fall with the share sent. Haiku with thinking switched off or at low effort was written (`run4h2.ts`) and not run: it needs about USD 0.07 and the lead's go. Until it is measured, "Jev is cheaper than Haiku" is true for one pass of one design (Table 2: Jev 0.0010 per 100 units against Haiku 0.0037 to 0.0041) and false for the full J* head (0.0057).

The Table 5 simulation (selecting units from the full-file Haiku runs) and this real run differ by 0.4 point (simulated 93.5% at 40% sent, real 93.1% at 46% sent) and by 2.2 points (simulated 95.1% at 50% sent, real 92.9% at 60% sent); both differences are inside the intervals.

### Noul and choice side by side at equal settings (`an22.out.md`)

Key, 465 units, one pass, definitions inside each question or inside `criteria`, whole-file flat window unless stated.

| Design | Key accuracy % [Wilson 95%], 1 pass | What it is |
|---|---|---|
| nl-flatL | 71.8 [67.6, 75.7] | five yes/no questions per unit, definitions in each question, whole-file flat window (the phase 1 to 3 style, larger window) |
| ch-flatL-in | 75.1 [70.9, 78.8] | one choice question per unit, definitions in criteria, whole-file flat window |
| ch-flatL-st | 74.6 [70.5, 78.4] | one choice question per unit, definitions once in the state, whole-file flat window |
| ch-flatS-in | 77.6 [73.6, 81.2] | one choice question per unit, definitions in criteria, flat window of 30 units |
| ch-structL-in | 78.3 [74.3, 81.8] | one choice question per unit, definitions in criteria, structured whole-file window |
| ch-structS-in | 80.0 [76.1, 83.4] | one choice question per unit, definitions in criteria, structured window of about 30 units |

### Request and answer shape of the question types (from `cassette4.jsonl.gz`, route `typesafe`)

- Endpoint `POST https://api.typesafe.ai/v1/systemone`, bearer token, body `{model, state, questions}`. `model` is required (a body without it returns 422 "Field required"). `state` is a string (here the numbered window). `questions` is a map of name to question.
- `noul`: `{"type":"noul","instructions":{"question":"Is [1] a rule?"}}`; answer `{"type":"noul","noul":0.9}`.
- `choice`: `{"type":"choice","instructions":"Which label does unit [1] of the window have?","criteria":{"rule":"<definition>","prohibition":"<definition>", ...}}`; answer `{"type":"choice","choice":"rule","confidence":0.77,"probabilities":{"rule":0.81,"prohibition":0.01,"gate":0.18,"example":0,"description":0,"none":0}}`. Probabilities are rounded to 2 decimals. `criteria` values may be `null` (the label alone) or a definition.
- `score`: `{"type":"score","instructions":"How strongly does unit [1] instruct the reader?","criteria":["not an instruction","a soft suggestion","a firm instruction"]}`; answer `{"type":"score","score":2,"confidence":1,"legend":{"0":"not an instruction","1":"a soft suggestion","2":"a firm instruction"},"probabilities":{"0":0,"1":0,"2":1}}`.
- Response also carries `usage {input_tokens, output_tokens}` per call. Largest successful call in these runs: 936 questions in one call. Output tokens are not the limit; the input cap is about 65k tokens per call.
- The score type was exercised in one probe call (`probe4b.ts`) and not used in a labelling design.

### Spans, key units (`an20.ts`, `tables4-spans-J1.md`)

Test files, rule found exactly (Jev head + pair head 66.9 / 70.3 / 68.6 P / R / F1; Haiku consensus 75.8 / 84.7 / 80.0). Predicted spans that equal a span of A or of C: Jev head + pair head 78.2% [70.2, 84.6]; spans produced by both Jev head + pair head and the Haiku consensus: 95.4% [88.8, 98.2] (87 spans, 63.6% recall). Full tables: `tables4-spans-J1.md`.

## Part II. The rubric fix on the 597-unit harbour set

What changed: `GUIDE4.md` (guide 2.1, 16 default decisions D1 to D16, each with a fictional example; `GUIDE.md` is the label-only form the labellers read, the old one is `GUIDE.v1.md`).

Annotators on the same 597 units: A' (author, guide 2.1, from the old author labels plus the 77 changes the new defaults require: `build-a2b.ts`), B'1 (a fresh Haiku annotator, guide 2.0), B'2 (a second fresh Haiku annotator, guide 2.1). No annotator saw the old labels or another annotator's output.

| Pair | Same label | Agreement % | Cohen kappa | Instruction vs not, % |
|---|---|---|---|---|
| Old: A vs B (old guide, phase 2) | 540 | 90.5 | 0.870 | not recorded |
| A' vs B'1 (guide 2.0) | 550 | 92.1 | 0.896 | 96.5 |
| A' vs B'2 (guide 2.1) | 567 | 95.0 | 0.934 | 97.0 |
| B'1 vs B'2 | 559 | 93.6 | 0.916 | 97.2 |

Confusion A' (rows) against B'2: `agree2b.ts` (rule/description 17 of the 30 disagreements; no other pair above 4). Disagreement lists: `disagreements2b-r1.tsv`, `disagreements2b-r2.tsv`.

Read this with two cautions. First, I wrote the guide 2.1 clarifications (D11 to D16) after reading the disagreements of B'1 against A' on these same units, so the 95.0% is measured on the units the rules were tuned to; the invented examples in the guide are not from the corpus, but the decisions are. Only the next estate (Part III) tests whether the rules carry over. Second, A' is the author who wrote the guide.

**Gold2b** (not `gold3`, which is the span corpus): label = the one at least two of A', B'1, B'2 give, else A'. 597 units, 30 where A' and B'2 differ, 1 three-way split. 543 labels equal the old gold. Counts: description 209, none 122, rule 153, prohibition 56, example 31, gate 26. sha256 `28f195326950a1ae7d57e91826f669fa031722d56880d4dc18c5dbc299bb8955` (`gold2b.json`, `gold2b.sha256`, built by `freeze2b.ts`). Two of the three annotators behind it are Haiku runs, so Haiku scores against it are inflated. The Haiku majority against A' alone is 94.6% [92.5, 96.2], against the old gold under the old guide 92.1%.

### Rerun of the best designs against gold2b

Haiku: 54 calls (3 runs x 18 windows of 40 units) under guide 2.1 (`results2/haiku2b-r*.json`, cassette `cassette2b-haiku`). Jev: the phase 2 recorded answers (old definitions) rescored, plus 144 new calls with the definitions of guide 2.1 in `criteria` (`results2b/jev2b-*`). Jev A/B, windows of 30 units, `choice`:

| Design (3 passes averaged) | All 597 | Test 375 | Agreed 567 | 10% unsure (all) | 15% unsure | 20% unsure |
|---|---|---|---|---|---|---|
| Jev choice, definitions of phase 4, 1 pass | 80.4 [77.0, 83.4] | 82.7 [78.5, 86.2] | 81.3 [77.9, 84.3] | 84.0 [80.6, 86.8] (abst 10.1) | 86.6 [83.3, 89.3] (abst 15.1) | 87.9 [84.6, 90.5] (abst 19.9) |
| Jev choice, definitions of phase 4, raw | 80.2 [76.9, 83.2] | 82.1 [77.9, 85.7] | 81.3 [77.9, 84.3] | 84.5 [81.2, 87.4] (abst 10.1) | 87.0 [83.8, 89.6] (abst 15.1) | 88.1 [84.9, 90.7] (abst 19.9) |
| Jev choice, definitions of phase 4, calibrated | 82.6 [79.3, 85.4] | 82.7 [78.5, 86.2] | 83.6 [80.3, 86.4] | 85.7 [82.4, 88.4] (abst 10.1) | 87.4 [84.2, 90.0] (abst 15.1) | 88.7 [85.6, 91.2] (abst 19.9) |
| Jev choice, definitions of phase 4, calibrated + 3 Haiku votes | 95.3 [93.3, 96.7] | 95.5 [92.9, 97.2] | 96.5 [94.6, 97.7] | 97.4 [95.7, 98.4] (abst 10.1) | 98.0 [96.4, 98.9] (abst 15.1) | 98.7 [97.3, 99.4] (abst 19.9) |
<!-- old: calls per pass 24, tokens in per pass 137018, out 37131, median ms 263, p90 ms 310 -->
| Jev choice, definitions of guide 2.1, 1 pass | 76.7 [73.2, 79.9] | 77.3 [72.8, 81.3] | 78.5 [74.9, 81.7] | 80.6 [77.1, 83.8] (abst 10.1) | 82.4 [78.9, 85.5] (abst 15.1) | 84.7 [81.2, 87.7] (abst 19.9) |
| Jev choice, definitions of guide 2.1, raw | 77.2 [73.7, 80.4] | 77.9 [73.4, 81.8] | 78.8 [75.3, 82.0] | 80.4 [76.9, 83.6] (abst 10.1) | 82.6 [79.1, 85.7] (abst 15.1) | 84.3 [80.8, 87.3] (abst 19.9) |
| Jev choice, definitions of guide 2.1, calibrated | 80.1 [76.7, 83.1] | 80.3 [75.9, 84.0] | 81.1 [77.7, 84.1] | 84.2 [80.8, 87.0] (abst 10.1) | 85.4 [82.1, 88.2] (abst 15.1) | 87.0 [83.7, 89.7] (abst 19.9) |
| Jev choice, definitions of guide 2.1, calibrated + 3 Haiku votes | 95.5 [93.5, 96.9] | 95.5 [92.9, 97.2] | 96.5 [94.6, 97.7] | 97.4 [95.7, 98.4] (abst 10.1) | 98.2 [96.7, 99.1] (abst 15.1) | 98.3 [96.7, 99.1] (abst 19.9) |
<!-- new: calls per pass 24, tokens in per pass 215225, out 37242, median ms 287, p90 ms 546 -->
| Haiku, majority of 3 (guide 2.1) | 95.8 [93.9, 97.1] | 95.7 [93.2, 97.4] | 96.8 [95.0, 98.0] | - | - | - |

| Row scored against A' alone (597 units) | Accuracy % [Wilson 95%] |
|---|---|
| Jev choice, phase 4 definitions, raw, 3 passes | 80.2 [76.9, 83.2] |
| Jev choice, guide 2.1 definitions, raw, 3 passes | 78.1 [74.6, 81.2] |
| Haiku, majority of 3 (guide 2.1) | 94.6 [92.5, 96.2] |

Reading: Haiku gains 3.7 points from the new guide (92.1 to 95.8%). Jev with its old definitions loses against the new gold, since the decisions changed under it. Giving Jev the guide-2.1 definitions verbatim did not help (calibrated 80.1% against 82.6% in this one run of 3 passes): the decisions D1 to D16 live in the head's training labels, not in the question text.

Cascade and stacker tables, gold2b (Haiku under guide 2.1; Jev answers from the phase 2 recordings with old definitions; stacker trained on gold2b labels, leave one file out). Accuracy on accepted units with abstain in brackets, test = 375 units, all = 597, agreed = 567:

### Second labeller and the cascade (arm e), and the best combination (arm f)

Haiku = `claude-haiku-5-5`, the labelling guide as system prompt, windows of 40 units, 3 runs. "To Haiku" = share of units whose first-labeller confidence is below the margin m.

| Design | Test acc % (abstain %) | All acc % (abstain %) | Agreed acc % (abstain %) |
|---|---|---|---|
| Jev arm 0 alone (3-pass mean) | 73.3 (0.0) | 71.9 (0.0) | 72.7 (0.0) |
| Jev stacker alone | 82.7 (0.0) | 82.2 (0.0) | 83.4 (0.0) |
| Jev stacker, abstain lowest 10% | 84.9 (9.9) | 84.7 (10.1) | 86.1 (10.1) |
| Jev stacker, abstain lowest 30% | 89.4 (29.3) | 90.7 (30.0) | 92.4 (30.0) |
| Haiku, one run (run 1) | 94.7 (0.0) | 94.6 (0.0) | 95.9 (0.0) |
| Haiku, majority of 3 | 95.7 (0.0) | 95.8 (0.0) | 96.8 (0.0) |
| Haiku, unanimous of 3 else abstain | 98.0 (5.9) | 97.5 (5.5) | 98.0 (4.1) |
| e: arm 0 as first labeller, m=0.3 (to Haiku 43%), abstain if Haiku not unanimous | 87.1 (2.9) | 87.4 (2.8) | 88.3 (2.3) |
| e: arm 0 as first labeller, m=0.6 (to Haiku 74%), abstain if Haiku not unanimous | 96.6 (5.3) | 96.1 (4.9) | 96.9 (4.1) |
| e: arm 0 as first labeller, m=0.9 (to Haiku 99%), abstain if Haiku not unanimous | 98.0 (5.9) | 97.5 (5.5) | 98.0 (4.1) |
| e: arm 0 as first labeller: accept iff it equals Haiku majority | 97.1 (26.4) | 97.9 (28.3) | 98.8 (27.9) |
| e: arm 0 as first labeller: accept iff it equals Haiku majority and Haiku unanimous | 98.9 (29.9) | 99.0 (31.0) | 99.3 (29.5) |
| f: stacker as first labeller, m=0.3 (to Haiku 14%), abstain if Haiku not unanimous | 86.5 (1.3) | 86.8 (1.3) | 88.2 (1.2) |
| f: stacker as first labeller, m=0.6 (to Haiku 33%), abstain if Haiku not unanimous | 92.3 (3.2) | 92.6 (3.0) | 94.0 (2.5) |
| f: stacker as first labeller, m=0.9 (to Haiku 71%), abstain if Haiku not unanimous | 96.9 (5.1) | 96.7 (4.9) | 97.3 (3.5) |
| f: stacker as first labeller: accept iff it equals Haiku majority | 96.5 (15.5) | 97.2 (16.8) | 97.9 (15.9) |
| f: stacker as first labeller: accept iff it equals Haiku majority and Haiku unanimous | 98.7 (20.0) | 98.7 (20.6) | 98.9 (18.7) |
| f2: one stacker over Jev features + Haiku vote counts | 94.1 (0.0) | 94.0 (0.0) | 95.2 (0.0) |
| f2, abstain lowest 5% | 95.8 (5.6) | 95.8 (5.0) | 96.7 (4.6) |
| f2, abstain lowest 10% | 96.7 (10.7) | 96.8 (10.1) | 97.5 (9.3) |
| f2, abstain lowest 15% | 97.8 (14.9) | 98.2 (15.1) | 98.6 (13.2) |
| f2, abstain lowest 20% | 97.7 (19.7) | 98.3 (19.9) | 98.7 (18.2) |

Haiku cost: 54 calls for 3 passes.

**Accuracy at 0, 10, 15 and 20% unsure, all 597 units, best designs:**

| Design | 0% | 10% | 15% | 20% |
|---|---|---|---|---|
| Haiku majority of 3 | 95.8 | not applicable (use unanimity) | | |
| Haiku unanimous else unsure | 97.5 at 5.5% unsure | | | |
| Jev (phase 2 recordings) + 3 Haiku votes, one head (f2) | 94.0 | 96.8 | 98.2 | 98.3 |
| Jev choice (phase 4 definitions), calibrated + 3 Haiku votes | 95.3 | 97.4 | 98.0 | 98.7 |
| Jev choice (guide 2.1 definitions), calibrated + 3 Haiku votes | 95.5 | 97.4 | 98.2 | 98.3 |
| Jev choice alone, calibrated (phase 4 definitions) | 82.6 | 85.7 | 87.4 | 88.7 |

Sources: `tables2b.out.md` (f2 rows and Haiku), `an2bj.out.md`. Intervals for the choice rows are in the table above.

**Remaining error shapes** (`errs2b.out.md`; Haiku majority, 25 wrong of 597):

- rule read as description, 9 times: output-spec fragments written as statements ("The note to the office carries the code, the question, and what you already told them.") and first-column cells of an instruction table ("Price differs from the card").
- description read as rule, 5 times: log-field names and short noun phrases in lists ("Item described in the customer's words").
- example read as description, 3 times: one-line stories not introduced as examples ("Fog is the harbour's only real timetable.").
- none read as description, 2 times, and description read as none, 1: bold statements and the closing line of a file.
- The 33 units on which the 3 Haiku runs disagree carry 11 of the 25 errors: Haiku's majority is right on 66.7% of them, and the unanimous 564 units are right on 97.5%.

## Part III. Growing the gold set to 1,200 agreed units

Not done yet in this file. Status and numbers are in `RESULTS-5.md` when it exists. Plan: three fictional estates (support prose, a code-interpreter estate, a channel-tabbed prompt), 1,450 or more units written by me with inline tags, labelled independently by an Opus subagent under guide 2.1 plus the span step; no Jev or Haiku annotator.

## Efficiency summary per 100 units (from Tables 2 and 7)

- Jev, one choice pass, window 30: 3.7 calls, 23.0k input tokens, 6.2k output tokens, median 0.26 s per call, USD 0.0010.
- Jev, J* head (10.6 calls): 136.1k input tokens, 67.5k output tokens, median 0.31 s, 90th percentile 0.49 s, USD 0.0057, 3.6 s.
- Haiku, one run: 1.6 calls, 4.4k input, 6.5k to 7.3k output, median 14.8 to 19.5 s per call, USD 0.0037 to 0.0041, about 27 to 31 s.
- Haiku, 3 runs: 4.8 calls, 13.3k input, 21.0k output, USD 0.0118, 89.6 s.

## Spend

| Run | Calls | Input tokens | Output tokens | USD |
|---|---|---|---|---|
| Jev phase 4 (`cassette4`) | 1,960 ok of 1,964 | 10,203,187 | 2,845,964 | 0.429 |
| Haiku cascade subsets (`cassette4-haiku`) | 54 | 157,110 | 209,088 | 0.120 |
| Jev harbour A/B (`cassette2b`) | 144 | 1,056,729 | 223,101 | 0.044 |
| Haiku harbour reruns (`cassette2b-haiku`) | 54 | 246,582 | 78,024 | 0.064 |
| Total this segment | | | | 0.657 |

Computed from the usage fields in the cassettes. The two Haiku subset processes ran at the same time on one budget file in phase 4, so the budget file undercounts; the figures above are from the cassette entries. With the 0.30 of phase 3 the owner line stands at about 0.96 of USD 50.

## Limits

- One fictional estate (9 files, 566 units; 597 for the harbour set). One estate is one estate.
- The key (A = C) drops the 101 hardest units; its accuracies are ceilings for this estate.
- About 25 designs were compared; the best was picked with the key in view. The dev/test split (3 and 6 files) protects the thresholds only.
- The heads need labelled units of the same estate (about 400 here). With Haiku majority labels instead of the key the J* head loses 0.6 point (82.8 against 82.2 is within noise); smaller training sets were not measured.
- Gold2b is influenced by Haiku annotators and by reading the disagreements before writing the last rules.
- Haiku thinking settings and a Haiku call limited to the unsure units alone were not measured; the cost of system 2 is not at its floor.

## Files

`GUIDE4.md`, `GUIDE.md`, `GUIDE.v1.md`, `gold2b.json`, `gold2b.sha256`, `annot2b-a.tsv`, `annot2b-b1.tsv`, `annot2b-b2.tsv`, `disagreements2b-r1.tsv`, `disagreements2b-r2.tsv`, `agree2b.ts`, `freeze2b.ts`, `run2b-haiku.sh`, `run2bj.ts`, `an2bj.ts`, `errs2b.ts`, `tables2b.out.md`, `tables4.out.md`, `tables4-spans-J1.md`, `an21.ts`, `an22.ts`, `STACK-SPEC.md`, `results2b/`, `results4/`, four cassettes.
