### Table 1. Per-unit label accuracy on the answer key (units where A and C agree)

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

### Table 2. Efficiency per 100 units

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

### Table 3. Batch size: one choice question per unit, key accuracy of one pass

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

### Table 4. Calibrated heads over Jev answers (leave one file out, trained on the key labels of the other files)

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

### Table 5. Jev first, Haiku second: operating points on the key

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

### Table 6. Where the labels go wrong (key units)

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

