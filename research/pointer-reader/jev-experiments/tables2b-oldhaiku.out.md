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
| Haiku, one run (run 1) | 86.4 (0.0) | 86.9 (0.0) | 88.5 (0.0) |
| Haiku, majority of 3 | 87.5 (0.0) | 87.3 (0.0) | 88.9 (0.0) |
| Haiku, unanimous of 3 else abstain | 90.1 (6.1) | 90.4 (7.4) | 92.2 (7.2) |
| e: arm 0 as first labeller, m=0.3 (to Haiku 43%), abstain if Haiku not unanimous | 84.2 (3.7) | 83.7 (4.7) | 85.2 (4.6) |
| e: arm 0 as first labeller, m=0.6 (to Haiku 74%), abstain if Haiku not unanimous | 89.2 (5.9) | 89.5 (7.0) | 91.3 (6.9) |
| e: arm 0 as first labeller, m=0.9 (to Haiku 99%), abstain if Haiku not unanimous | 90.1 (6.1) | 90.4 (7.4) | 92.2 (7.2) |
| e: arm 0 as first labeller: accept iff it equals Haiku majority | 90.0 (22.7) | 92.1 (26.1) | 93.6 (26.1) |
| e: arm 0 as first labeller: accept iff it equals Haiku majority and Haiku unanimous | 92.0 (26.4) | 94.0 (30.0) | 95.5 (29.6) |
| f: stacker as first labeller, m=0.3 (to Haiku 14%), abstain if Haiku not unanimous | 85.8 (2.1) | 85.1 (2.0) | 86.8 (2.1) |
| f: stacker as first labeller, m=0.6 (to Haiku 33%), abstain if Haiku not unanimous | 88.1 (3.5) | 88.1 (4.2) | 90.1 (4.1) |
| f: stacker as first labeller, m=0.9 (to Haiku 71%), abstain if Haiku not unanimous | 90.7 (5.6) | 90.7 (6.7) | 92.4 (6.7) |
| f: stacker as first labeller: accept iff it equals Haiku majority | 91.0 (13.9) | 91.9 (15.4) | 93.3 (15.2) |
| f: stacker as first labeller: accept iff it equals Haiku majority and Haiku unanimous | 92.0 (16.8) | 93.2 (18.9) | 94.6 (18.3) |
| f2: one stacker over Jev features + Haiku vote counts | 85.9 (0.0) | 85.6 (0.0) | 87.1 (0.0) |
| f2, abstain lowest 5% | 88.0 (4.8) | 87.7 (5.0) | 89.1 (4.6) |
| f2, abstain lowest 10% | 88.6 (9.1) | 89.4 (10.1) | 91.0 (9.5) |
| f2, abstain lowest 15% | 89.3 (12.8) | 90.3 (15.1) | 92.2 (14.5) |
| f2, abstain lowest 20% | 91.2 (18.1) | 92.3 (19.9) | 93.7 (19.0) |

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
| rule | 121 | 4 | 2 | 1 | 25 | 0 | 79.1 |
| prohibition | 7 | 41 | 0 | 0 | 8 | 0 | 73.2 |
| gate | 1 | 1 | 24 | 0 | 0 | 0 | 92.3 |
| example | 4 | 0 | 0 | 25 | 2 | 0 | 80.6 |
| description | 20 | 6 | 0 | 0 | 180 | 3 | 86.1 |
| none | 0 | 0 | 0 | 0 | 2 | 120 | 98.4 |
| precision % | 79.1 | 78.8 | 92.3 | 96.2 | 82.9 | 97.6 | |

**Haiku majority of 3**, all 597 units

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 123 | 3 | 2 | 1 | 24 | 0 | 80.4 |
| prohibition | 8 | 45 | 0 | 0 | 3 | 0 | 80.4 |
| gate | 1 | 0 | 25 | 0 | 0 | 0 | 96.2 |
| example | 1 | 0 | 0 | 26 | 4 | 0 | 83.9 |
| description | 19 | 6 | 0 | 0 | 180 | 4 | 86.1 |
| none | 0 | 0 | 0 | 0 | 0 | 122 | 100.0 |
| precision % | 80.9 | 83.3 | 92.6 | 96.3 | 85.3 | 96.8 | |

