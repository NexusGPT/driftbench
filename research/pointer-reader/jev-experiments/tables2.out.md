### Arms alone: one pass, and the mean probability of 3 passes

Threshold chosen on the dev files among 0.3 to 0.7. "Test" = 5 files, 375 units; "all" = 597; "agreed" = the 540 units both annotators labelled alike. "Abst 10%" = the 10% of units with the lowest confidence held back. Calls and tokens are per pass over the 597 units.

| Arm | t | Calls / pass | Tokens in / out per pass (k) | One pass, test acc % (min to max of 3) | Mean of 3 passes, test acc % | Mean of 3, all acc % | Mean of 3, agreed acc % | Mean of 3, test acc with abst 10% (accepted) |
|---|---|---|---|---|---|---|---|---|
| 0 baseline: phase 1 design (5 definition questions, window of 30) | 0.4 | 24 | 156 / 64 | 77.1 (75.7 to 78.1) | 77.6 | 74.4 | 76.1 | 79.6 (abst 9.6) |
| a decision rules + contrastive examples (window of 20) | 0.4 | 33 | 463 / 64 | 76.4 (75.7 to 76.8) | 76.3 | 75.7 | 77.2 | 79.9 (abst 9.9) |
| b six decomposed sub-questions, combined in code (window of 25) | 0.7 | 28 | 231 / 76 | 72.6 (72.3 to 73.1) | 72.3 | 71.4 | 72.8 | 74.1 (abst 8.5) |
| d0 context removed (no heading lines) | 0.5 | 24 | 154 / 64 | 77.2 (76.8 to 77.3) | 77.9 | 75.2 | 76.9 | 81.5 (abst 9.1) |
| d2 context added (heading lines + file role line) | 0.4 | 24 | 156 / 64 | 77.0 (76.3 to 77.6) | 76.5 | 74.2 | 75.6 | 80.6 (abst 9.1) |
| c 3 paraphrases, probabilities averaged (window of 30) | 0.5 | 72 | 501 / 226 | 79.9 (79.5 to 80.3) | 80.8 | 78.7 | 80.4 | 83.1 (abst 10.1) |

For arm c the "one pass" column is one pass of one paraphrase (calls and tokens in the row are for all three paraphrases once). For arms 0, a, b, d the mean of 3 passes repeats the same questions 3 times.

### Calibrated stacker over Jev probabilities (leave-one-file-out, 3-pass mean features)

Multinomial logistic regression, L2 0.03, trained on the 7 other files for each file; no test file is in its own training set.

| Features | Test acc % | All acc % | Agreed acc % | Test, abst 10% (accepted acc) | Test, abst 30% (accepted acc) |
|---|---|---|---|---|---|
| arm 0 only | 78.4 | 75.9 | 79.4 | 81.0 | 86.9 |
| arm a only | 78.4 | 79.1 | 82.2 | 82.7 | 91.4 |
| arm b only | 80.5 | 81.4 | 84.4 | 84.4 | 91.8 |
| arm c only | 82.7 | 82.7 | 86.7 | 85.0 | 90.1 |
| arm d only (none + role) | 80.3 | 79.4 | 82.4 | 83.9 | 88.7 |
| all Jev designs (arms 0, a, b, c, d) | 86.1 | 86.3 | 90.2 | 90.5 | 95.8 |

Calls for the all-designs stacker: 205 per pass over the 597 units, times 3 passes = 615 calls.

### Second labeller and the cascade (arm e), and the best combination (arm f)

Haiku = `claude-haiku-5-5`, the labelling guide as system prompt, windows of 40 units, 3 runs. "To Haiku" = share of units whose first-labeller confidence is below the margin m.

| Design | Test acc % (abstain %) | All acc % (abstain %) | Agreed acc % (abstain %) |
|---|---|---|---|
| Jev arm 0 alone (3-pass mean) | 77.6 (0.0) | 74.4 (0.0) | 76.1 (0.0) |
| Jev stacker alone | 86.1 (0.0) | 86.3 (0.0) | 90.2 (0.0) |
| Jev stacker, abstain lowest 10% | 90.5 (10.1) | 90.5 (10.1) | 94.1 (9.4) |
| Jev stacker, abstain lowest 30% | 95.8 (29.9) | 95.0 (30.0) | 97.2 (27.8) |
| Haiku, one run (run 1) | 90.4 (0.0) | 91.5 (0.0) | 94.3 (0.0) |
| Haiku, majority of 3 | 91.5 (0.0) | 92.1 (0.0) | 94.6 (0.0) |
| Haiku, unanimous of 3 else abstain | 94.6 (6.1) | 94.8 (7.4) | 97.4 (7.4) |
| e: arm 0 as first labeller, m=0.3 (to Haiku 43%), abstain if Haiku not unanimous | 89.8 (3.7) | 88.8 (4.7) | 90.9 (4.8) |
| e: arm 0 as first labeller, m=0.6 (to Haiku 74%), abstain if Haiku not unanimous | 93.8 (5.9) | 93.9 (7.0) | 96.4 (7.0) |
| e: arm 0 as first labeller, m=0.9 (to Haiku 99%), abstain if Haiku not unanimous | 94.6 (6.1) | 94.8 (7.4) | 97.4 (7.4) |
| e: arm 0 as first labeller: accept iff it equals Haiku majority | 94.8 (22.7) | 95.9 (26.1) | 97.3 (24.3) |
| e: arm 0 as first labeller: accept iff it equals Haiku majority and Haiku unanimous | 96.4 (26.4) | 97.4 (30.0) | 99.0 (28.3) |
| f: stacker as first labeller, m=0.3 (to Haiku 10%), abstain if Haiku not unanimous | 90.3 (0.8) | 90.4 (1.0) | 93.8 (1.1) |
| f: stacker as first labeller, m=0.6 (to Haiku 26%), abstain if Haiku not unanimous | 93.7 (2.9) | 93.6 (3.7) | 96.2 (3.5) |
| f: stacker as first labeller, m=0.9 (to Haiku 60%), abstain if Haiku not unanimous | 94.7 (5.1) | 94.7 (5.9) | 97.2 (5.7) |
| f: stacker as first labeller: accept iff it equals Haiku majority | 95.3 (14.4) | 96.3 (15.1) | 98.1 (11.9) |
| f: stacker as first labeller: accept iff it equals Haiku majority and Haiku unanimous | 96.4 (17.6) | 97.1 (18.8) | 99.1 (15.9) |
| f2: one stacker over Jev features + Haiku vote counts | 92.8 (0.0) | 92.5 (0.0) | 95.4 (0.0) |
| f2, abstain lowest 5% | 94.6 (5.3) | 94.5 (5.0) | 96.9 (3.9) |
| f2, abstain lowest 10% | 95.5 (10.7) | 95.9 (10.1) | 97.6 (7.4) |
| f2, abstain lowest 15% | 96.6 (14.9) | 96.4 (15.1) | 98.1 (11.9) |
| f2, abstain lowest 20% | 97.0 (19.7) | 97.1 (19.9) | 98.7 (16.7) |

Haiku cost: 54 calls for 3 passes.

### Confusion matrices

**0 baseline: phase 1 design (5 definition questions, window of 30)**, all 597 units, t=0.4 (rows gold, columns predicted)

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 109 | 9 | 16 | 1 | 5 | 9 | 73.2 |
| prohibition | 3 | 41 | 1 | 0 | 3 | 0 | 85.4 |
| gate | 5 | 1 | 19 | 0 | 0 | 0 | 76.0 |
| example | 0 | 0 | 0 | 23 | 1 | 0 | 95.8 |
| description | 21 | 6 | 1 | 17 | 169 | 14 | 74.1 |
| none | 10 | 2 | 7 | 3 | 18 | 83 | 67.5 |
| precision % | 73.6 | 69.5 | 43.2 | 52.3 | 86.2 | 78.3 | |

**a decision rules + contrastive examples (window of 20)**, all 597 units, t=0.4 (rows gold, columns predicted)

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 103 | 14 | 16 | 1 | 2 | 13 | 69.1 |
| prohibition | 2 | 45 | 0 | 0 | 1 | 0 | 93.8 |
| gate | 4 | 1 | 20 | 0 | 0 | 0 | 80.0 |
| example | 0 | 0 | 0 | 22 | 1 | 1 | 91.7 |
| description | 25 | 8 | 5 | 2 | 181 | 7 | 79.4 |
| none | 12 | 4 | 9 | 4 | 13 | 81 | 65.9 |
| precision % | 70.5 | 62.5 | 40.0 | 75.9 | 91.4 | 79.4 | |

**b six decomposed sub-questions, combined in code (window of 25)**, all 597 units, t=0.7 (rows gold, columns predicted)

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 111 | 11 | 16 | 2 | 9 | 0 | 74.5 |
| prohibition | 4 | 37 | 1 | 1 | 5 | 0 | 77.1 |
| gate | 0 | 1 | 24 | 0 | 0 | 0 | 96.0 |
| example | 0 | 0 | 0 | 21 | 3 | 0 | 87.5 |
| description | 17 | 1 | 9 | 10 | 189 | 2 | 82.9 |
| none | 10 | 2 | 5 | 0 | 62 | 44 | 35.8 |
| precision % | 78.2 | 71.2 | 43.6 | 61.8 | 70.5 | 95.7 | |

**d0 context removed (no heading lines)**, all 597 units, t=0.5 (rows gold, columns predicted)

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 109 | 9 | 9 | 0 | 4 | 18 | 73.2 |
| prohibition | 4 | 41 | 1 | 0 | 1 | 1 | 85.4 |
| gate | 5 | 1 | 19 | 0 | 0 | 0 | 76.0 |
| example | 0 | 0 | 0 | 23 | 1 | 0 | 95.8 |
| description | 22 | 7 | 1 | 15 | 160 | 23 | 70.2 |
| none | 5 | 1 | 6 | 3 | 11 | 97 | 78.9 |
| precision % | 75.2 | 69.5 | 52.8 | 56.1 | 90.4 | 69.8 | |

**d2 context added (heading lines + file role line)**, all 597 units, t=0.4 (rows gold, columns predicted)

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 110 | 10 | 13 | 0 | 7 | 9 | 73.8 |
| prohibition | 4 | 40 | 2 | 0 | 2 | 0 | 83.3 |
| gate | 6 | 1 | 18 | 0 | 0 | 0 | 72.0 |
| example | 0 | 0 | 0 | 23 | 1 | 0 | 95.8 |
| description | 20 | 7 | 1 | 19 | 172 | 9 | 75.4 |
| none | 9 | 2 | 6 | 3 | 23 | 80 | 65.0 |
| precision % | 73.8 | 66.7 | 45.0 | 51.1 | 83.9 | 81.6 | |

**c 3 paraphrases averaged**, all 597 units, t=0.5

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 111 | 9 | 11 | 1 | 7 | 10 | 74.5 |
| prohibition | 2 | 43 | 1 | 0 | 2 | 0 | 89.6 |
| gate | 2 | 1 | 22 | 0 | 0 | 0 | 88.0 |
| example | 0 | 0 | 0 | 22 | 2 | 0 | 91.7 |
| description | 17 | 7 | 2 | 7 | 181 | 14 | 79.4 |
| none | 4 | 3 | 6 | 4 | 15 | 91 | 74.0 |
| precision % | 81.6 | 68.3 | 52.4 | 64.7 | 87.4 | 79.1 | |

**Calibrated stacker over all Jev designs**, all 597 units (leave-one-file-out)

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 129 | 7 | 2 | 0 | 11 | 0 | 86.6 |
| prohibition | 5 | 37 | 0 | 0 | 6 | 0 | 77.1 |
| gate | 6 | 1 | 18 | 0 | 0 | 0 | 72.0 |
| example | 0 | 0 | 0 | 20 | 2 | 2 | 83.3 |
| description | 14 | 3 | 1 | 1 | 201 | 8 | 88.2 |
| none | 2 | 1 | 2 | 0 | 8 | 110 | 89.4 |
| precision % | 82.7 | 75.5 | 78.3 | 95.2 | 88.2 | 91.7 | |

**f2: stacker over Jev features + Haiku votes**, all 597 units (leave-one-file-out)

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 135 | 2 | 3 | 0 | 9 | 0 | 90.6 |
| prohibition | 2 | 43 | 0 | 0 | 3 | 0 | 89.6 |
| gate | 1 | 1 | 23 | 0 | 0 | 0 | 92.0 |
| example | 0 | 0 | 0 | 23 | 1 | 0 | 95.8 |
| description | 12 | 4 | 0 | 0 | 209 | 3 | 91.7 |
| none | 0 | 0 | 0 | 2 | 2 | 119 | 96.7 |
| precision % | 90.0 | 86.0 | 88.5 | 92.0 | 93.3 | 97.5 | |

**Haiku majority of 3**, all 597 units

| gold | rule | prohibition | gate | example | description | none | recall % |
|---|---|---|---|---|---|---|---|
| rule | 132 | 4 | 3 | 2 | 8 | 0 | 88.6 |
| prohibition | 1 | 47 | 0 | 0 | 0 | 0 | 97.9 |
| gate | 1 | 0 | 24 | 0 | 0 | 0 | 96.0 |
| example | 0 | 0 | 0 | 23 | 1 | 0 | 95.8 |
| description | 18 | 3 | 0 | 1 | 202 | 4 | 88.6 |
| none | 0 | 0 | 0 | 1 | 0 | 122 | 99.2 |
| precision % | 86.8 | 87.0 | 88.9 | 85.2 | 95.7 | 96.8 | |

