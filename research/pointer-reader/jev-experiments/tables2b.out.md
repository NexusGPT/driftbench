### Arms alone: one pass, and the mean probability of 3 passes

Threshold chosen on the dev files among 0.3 to 0.7. "Test" = 5 files, 375 units; "all" = 597; "agreed" = the 540 units both annotators labelled alike. "Abst 10%" = the 10% of units with the lowest confidence held back. Calls and tokens are per pass over the 597 units.

| Arm | t | Calls / pass | Tokens in / out per pass (k) | One pass, test acc % (min to max of 3) | Mean of 3 passes, test acc % | Mean of 3, all acc % | Mean of 3, agreed acc % | Mean of 3, test acc with abst 10% (accepted) |
|---|---|---|---|---|---|---|---|---|
| 0 baseline: phase 1 design (5 definition questions, window of 30) | 0.4 | 24 | 156 / 64 | 72.7 (72.0 to 73.1) | 73.3 | 71.9 | 72.7 | 74.9 (abst 9.6) |
| a decision rules + contrastive examples (window of 20) | 0.4 | 33 | 463 / 64 | 72.1 (72.0 to 72.3) | 72.0 | 71.2 | 71.6 | 75.7 (abst 9.9) |
| b six decomposed sub-questions, combined in code (window of 25) | 0.7 | 28 | 231 / 76 | 68.7 (68.3 to 69.1) | 68.3 | 67.8 | 68.3 | 70.6 (abst 8.5) |
| d0 context removed (no heading lines) | 0.5 | 24 | 154 / 64 | 71.4 (70.7 to 71.7) | 71.7 | 71.4 | 72.3 | 75.4 (abst 9.1) |
| d2 context added (heading lines + file role line) | 0.4 | 24 | 156 / 64 | 72.3 (71.7 to 73.1) | 72.0 | 71.5 | 72.1 | 75.4 (abst 9.1) |
| c 3 paraphrases, probabilities averaged (window of 30) | 0.5 | 72 | 501 / 226 | 75.1 (74.7 to 75.5) | 76.0 | 75.5 | 76.2 | 77.7 (abst 10.1) |

For arm c the "one pass" column is one pass of one paraphrase (calls and tokens in the row are for all three paraphrases once). For arms 0, a, b, d the mean of 3 passes repeats the same questions 3 times.

### Calibrated stacker over Jev probabilities (leave-one-file-out, 3-pass mean features)

Multinomial logistic regression, L2 0.03, trained on the 7 other files for each file; no test file is in its own training set.

| Features | Test acc % | All acc % | Agreed acc % | Test, abst 10% (accepted acc) | Test, abst 30% (accepted acc) |
|---|---|---|---|---|---|
| arm 0 only | 73.6 | 73.0 | 73.9 | 76.5 | 81.0 |
| arm a only | 76.0 | 75.7 | 76.5 | 78.4 | 85.6 |
| arm b only | 78.1 | 79.1 | 79.9 | 81.0 | 86.8 |
| arm c only | 76.5 | 77.6 | 78.5 | 79.3 | 83.1 |
| arm d only (none + role) | 75.5 | 75.7 | 76.7 | 77.2 | 83.3 |
| all Jev designs (arms 0, a, b, c, d) | 82.7 | 82.2 | 83.4 | 84.9 | 89.4 |

Calls for the all-designs stacker: 205 per pass over the 597 units, times 3 passes = 615 calls.

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

### Confusion matrices

**0 baseline: phase 1 design (5 definition questions, window of 30)**, all 597 units, t=0.4 (rows gold, columns predicted)

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 103 | 7 | 13 | 7 | 14 | 9 | 67.3 |
| prohibition | 8 | 42 | 2 | 1 | 2 | 1 | 75.0 |
| gate | 6 | 1 | 19 | 0 | 0 | 0 | 73.1 |
| example | 1 | 0 | 2 | 24 | 3 | 1 | 77.4 |
| description | 20 | 7 | 1 | 9 | 159 | 13 | 76.1 |
| none | 10 | 2 | 7 | 3 | 18 | 82 | 67.2 |
| precision % | 69.6 | 71.2 | 43.2 | 54.5 | 81.1 | 77.4 | |

**a decision rules + contrastive examples (window of 20)**, all 597 units, t=0.4 (rows gold, columns predicted)

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 96 | 12 | 13 | 2 | 20 | 10 | 62.7 |
| prohibition | 6 | 45 | 0 | 0 | 4 | 1 | 80.4 |
| gate | 4 | 1 | 21 | 0 | 0 | 0 | 80.8 |
| example | 1 | 0 | 2 | 24 | 3 | 1 | 77.4 |
| description | 27 | 10 | 5 | 0 | 158 | 9 | 75.6 |
| none | 12 | 4 | 9 | 3 | 13 | 81 | 66.4 |
| precision % | 65.8 | 62.5 | 42.0 | 82.8 | 79.8 | 79.4 | |

**b six decomposed sub-questions, combined in code (window of 25)**, all 597 units, t=0.7 (rows gold, columns predicted)

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 103 | 10 | 13 | 6 | 21 | 0 | 67.3 |
| prohibition | 9 | 38 | 1 | 2 | 6 | 0 | 67.9 |
| gate | 1 | 1 | 24 | 0 | 0 | 0 | 92.3 |
| example | 1 | 0 | 2 | 22 | 6 | 0 | 71.0 |
| description | 18 | 1 | 10 | 4 | 174 | 2 | 83.3 |
| none | 10 | 2 | 5 | 0 | 61 | 44 | 36.1 |
| precision % | 72.5 | 73.1 | 43.6 | 64.7 | 64.9 | 95.7 | |

**d0 context removed (no heading lines)**, all 597 units, t=0.5 (rows gold, columns predicted)

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 100 | 7 | 7 | 3 | 18 | 18 | 65.4 |
| prohibition | 9 | 42 | 2 | 1 | 0 | 2 | 75.0 |
| gate | 6 | 1 | 19 | 0 | 0 | 0 | 73.1 |
| example | 2 | 0 | 1 | 24 | 3 | 1 | 77.4 |
| description | 23 | 8 | 1 | 10 | 145 | 22 | 69.4 |
| none | 5 | 1 | 6 | 3 | 11 | 96 | 78.7 |
| precision % | 69.0 | 71.2 | 52.8 | 58.5 | 81.9 | 69.1 | |

**d2 context added (heading lines + file role line)**, all 597 units, t=0.4 (rows gold, columns predicted)

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 103 | 7 | 11 | 7 | 16 | 9 | 67.3 |
| prohibition | 7 | 42 | 3 | 1 | 2 | 1 | 75.0 |
| gate | 7 | 1 | 18 | 0 | 0 | 0 | 69.2 |
| example | 2 | 0 | 1 | 24 | 3 | 1 | 77.4 |
| description | 21 | 8 | 1 | 10 | 161 | 8 | 77.0 |
| none | 9 | 2 | 6 | 3 | 23 | 79 | 64.8 |
| precision % | 69.1 | 70.0 | 45.0 | 53.3 | 78.5 | 80.6 | |

**c 3 paraphrases averaged**, all 597 units, t=0.5

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 106 | 7 | 9 | 4 | 19 | 8 | 69.3 |
| prohibition | 5 | 43 | 2 | 1 | 2 | 3 | 76.8 |
| gate | 3 | 1 | 22 | 0 | 0 | 0 | 84.6 |
| example | 2 | 0 | 1 | 23 | 4 | 1 | 74.2 |
| description | 16 | 9 | 2 | 2 | 167 | 13 | 79.9 |
| none | 4 | 3 | 6 | 4 | 15 | 90 | 73.8 |
| precision % | 77.9 | 68.3 | 52.4 | 67.6 | 80.7 | 78.3 | |

**Calibrated stacker over all Jev designs**, all 597 units (leave-one-file-out)

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 115 | 7 | 1 | 2 | 26 | 2 | 75.2 |
| prohibition | 8 | 39 | 1 | 1 | 6 | 1 | 69.6 |
| gate | 4 | 1 | 21 | 0 | 0 | 0 | 80.8 |
| example | 2 | 0 | 1 | 25 | 2 | 1 | 80.6 |
| description | 17 | 3 | 1 | 0 | 182 | 6 | 87.1 |
| none | 2 | 2 | 2 | 2 | 5 | 109 | 89.3 |
| precision % | 77.7 | 75.0 | 77.8 | 83.3 | 82.4 | 91.6 | |

**f2: stacker over Jev features + Haiku votes**, all 597 units (leave-one-file-out)

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 142 | 0 | 0 | 0 | 11 | 0 | 92.8 |
| prohibition | 2 | 51 | 0 | 1 | 1 | 1 | 91.1 |
| gate | 1 | 1 | 24 | 0 | 0 | 0 | 92.3 |
| example | 2 | 0 | 1 | 25 | 3 | 0 | 80.6 |
| description | 6 | 1 | 0 | 0 | 201 | 1 | 96.2 |
| none | 1 | 0 | 0 | 1 | 2 | 118 | 96.7 |
| precision % | 92.2 | 96.2 | 96.0 | 92.6 | 92.2 | 98.3 | |

**Haiku majority of 3**, all 597 units

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 144 | 0 | 0 | 0 | 9 | 0 | 94.1 |
| prohibition | 1 | 54 | 0 | 0 | 1 | 0 | 96.4 |
| gate | 1 | 1 | 24 | 0 | 0 | 0 | 92.3 |
| example | 0 | 0 | 0 | 28 | 3 | 0 | 90.3 |
| description | 5 | 0 | 0 | 0 | 203 | 1 | 97.1 |
| none | 1 | 0 | 0 | 0 | 2 | 119 | 97.5 |
| precision % | 94.7 | 98.2 | 100.0 | 100.0 | 93.1 | 99.2 | |

