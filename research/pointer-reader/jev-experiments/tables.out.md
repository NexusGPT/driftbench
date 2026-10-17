### Arm 0: the two wordings of the five definitions (window of 20 units, 100 questions per call)


| Variant | Runs (files in results/) | Calls per pass | Accuracy, % mean (min to max) | Macro F1, % mean | Invalid or missing answers | Mean ms per call | Sum of call time per pass, s | Tokens in per pass |
|---|---|---|---|---|---|---|---|---|
| exclusive wording (v2) | 3 (a1a-w20-defs2-r1, a1a-w20-defs2-r2, a1a-w20-defs2-r3) | 20 | 84.9 (84.8 to 85.1) | 84.5 | 0 of 5925 | 278 | 5.6 | 104k |
| design-doc wording (v1) | 3 (a1a-w20-r1, a1a-w20-r2, a1a-w20-r3) | 20 | 71.7 (70.4 to 72.7) | 63.2 | 0 of 5925 | 272 | 5.4 | 96k |
### Arm 1: batch shape (exclusive wording)


| Variant | Runs (files in results/) | Calls per pass | Accuracy, % mean (min to max) | Macro F1, % mean | Invalid or missing answers | Mean ms per call | Sum of call time per pass, s | Tokens in per pass |
|---|---|---|---|---|---|---|---|---|
| window of 20 units (100 questions) | 3 (a1a-w20-defs2-r1, a1a-w20-defs2-r2, a1a-w20-defs2-r3) | 20 | 84.9 (84.8 to 85.1) | 84.5 | 0 of 5925 | 278 | 5.6 | 104k |
| one unit per call (5 questions) | 3 (a1b-single-r1, a1b-single-r2, a1b-single-r3) | 395 | 77.8 (77.0 to 78.7) | 79.4 | 0 of 5925 | 226 | 89.3 | 204k |
### Arm 2: id form in the state and in the question (window of 20 units)


| Variant | Runs (files in results/) | Calls per pass | Accuracy, % mean (min to max) | Macro F1, % mean | Invalid or missing answers | Mean ms per call | Sum of call time per pass, s | Tokens in per pass |
|---|---|---|---|---|---|---|---|---|
| [12] bracket | 3 (a1a-w20-defs2-r1, a1a-w20-defs2-r2, a1a-w20-defs2-r3) | 20 | 84.9 (84.8 to 85.1) | 84.5 | 0 of 5925 | 278 | 5.6 | 104k |
| 12 (bare number) | 3 (a2-bare-r1, a2-bare-r2, a2-bare-r3) | 20 | 80.8 (80.5 to 81.0) | 81.4 | 0 of 5925 | 275 | 5.5 | 101k |
| ledger id k7m2q9x4ab | 3 (a2-ledger-r1, a2-ledger-r2, a2-ledger-r3) | 20 | 84.5 (84.3 to 84.6) | 84.6 | 0 of 5925 | 258 | 5.2 | 109k |
| unit text quoted in the question | 3 (a2-quote-r1, a2-quote-r2, a2-quote-r3) | 20 | 81.9 (81.5 to 82.3) | 81.6 | 0 of 5925 | 265 | 5.3 | 109k |
| <s12> | 3 (a2-tag-r1, a2-tag-r2, a2-tag-r3) | 20 | 85.0 (84.6 to 85.8) | 84.7 | 0 of 5925 | 265 | 5.3 | 106k |
### Arm 3: questions per call (5 labels per unit)


| Variant | Runs (files in results/) | Calls per pass | Accuracy, % mean (min to max) | Macro F1, % mean | Invalid or missing answers | Mean ms per call | Sum of call time per pass, s | Tokens in per pass |
|---|---|---|---|---|---|---|---|---|
| 100 questions (20 units) | 2 (a3-q100-r1, a3-q100-r2) | 20 | 84.6 (83.8 to 85.3) | 84.0 | 0 of 3950 | 259 | 5.2 | 104k |
| 1000 questions (200 units) | 2 (a3-q1000-r1, a3-q1000-r2) | 2 | 83.2 (83.0 to 83.3) | 84.5 | 0 of 3950 | 617 | 1.2 | 99k |
| 1250 questions (250 units) | 2 (a3-q1250-r1, a3-q1250-r2) | 2 | 83.4 (83.3 to 83.5) | 85.4 | 0 of 3950 | 919 | 1.8 | 99k |
| 150 questions (30 units) | 3 (a3-q150-r1, a3-q150-r2, a3-q150-r3) | 14 | 86.8 (86.1 to 87.3) | 87.2 | 0 of 5925 | 270 | 3.8 | 102k |
| 25 questions (5 units) | 2 (a3-q25-r1, a3-q25-r2) | 79 | 83.9 (83.5 to 84.3) | 82.8 | 0 of 3950 | 239 | 18.9 | 119k |
| 250 questions (50 units) | 3 (a3-q250-r1, a3-q250-r2, a3-q250-r3) | 8 | 86.3 (85.8 to 87.1) | 87.1 | 0 of 5925 | 322 | 2.6 | 100k |
| 400 questions (80 units) | 2 (a3-q400-r1, a3-q400-r2) | 5 | 85.8 (85.3 to 86.3) | 86.8 | 0 of 3950 | 403 | 2.0 | 99k |
| 50 questions (10 units) | 2 (a3-q50-r1, a3-q50-r2) | 40 | 84.7 (84.6 to 84.8) | 84.7 | 0 of 3950 | 236 | 9.4 | 109k |
| 600 questions (120 units) | 2 (a3-q600-r1, a3-q600-r2) | 4 | 83.9 (83.5 to 84.3) | 84.9 | 0 of 3950 | 642 | 2.6 | 99k |
### Arm 3: threshold sweep per size


| Variant | acc @0.3 / F1 @0.3 | acc @0.4 / F1 @0.4 | acc @0.5 / F1 @0.5 | acc @0.6 / F1 @0.6 | acc @0.7 / F1 @0.7 |
|---|---|---|---|---|---|
| 100 questions | 83.2 / 83.1 | 85.9 / 85.0 | 84.6 / 84.0 | 81.3 / 81.9 | 77.5 / 79.6 |
| 1000 questions | 81.8 / 82.7 | 83.3 / 84.5 | 83.2 / 84.5 | 81.5 / 83.5 | 77.8 / 80.8 |
| 1250 questions | 81.0 / 82.1 | 83.5 / 85.0 | 83.4 / 85.4 | 82.8 / 85.1 | 78.4 / 81.6 |
| 150 questions | 84.5 / 85.3 | 88.2 / 88.2 | 86.8 / 87.2 | 83.1 / 84.9 | 77.9 / 80.8 |
| 25 questions | 78.4 / 78.4 | 82.7 / 81.8 | 83.9 / 82.8 | 81.0 / 81.7 | 78.4 / 80.8 |
| 250 questions | 85.6 / 86.1 | 86.9 / 87.5 | 86.3 / 87.1 | 83.2 / 84.8 | 80.1 / 82.5 |
| 400 questions | 85.3 / 86.0 | 87.8 / 88.1 | 85.8 / 86.8 | 84.4 / 86.2 | 79.6 / 82.3 |
| 50 questions | 81.5 / 81.6 | 84.2 / 83.6 | 84.7 / 84.7 | 82.7 / 83.8 | 79.5 / 81.8 |
| 600 questions | 83.0 / 83.8 | 85.2 / 85.6 | 83.9 / 84.9 | 82.9 / 84.6 | 79.7 / 82.2 |
### Arm 4: flat labels against a two-level tree


| Variant | Runs (files in results/) | Calls per pass | Accuracy, % mean (min to max) | Macro F1, % mean | Invalid or missing answers | Mean ms per call | Sum of call time per pass, s | Tokens in per pass |
|---|---|---|---|---|---|---|---|---|
| flat, 5 questions per unit | 3 (a1a-w20-defs2-r1, a1a-w20-defs2-r2, a1a-w20-defs2-r3) | 20 | 84.9 (84.8 to 85.1) | 84.5 | 0 of 5925 | 278 | 5.6 | 104k |
| two-level tree | 3 (a4-tree-r1, a4-tree-r2, a4-tree-r3) | 41 | 84.1 (83.5 to 84.6) | 84.5 | 0 of 4049 | 246 | 10.1 | 89k |

### Threshold sweep for arms 0 to 4 (window of 20 units)

| Variant | acc @0.3 / F1 @0.3 | acc @0.4 / F1 @0.4 | acc @0.5 / F1 @0.5 | acc @0.6 / F1 @0.6 | acc @0.7 / F1 @0.7 |
|---|---|---|---|---|---|
| a1a-w20-defs2 | 84.1 / 83.9 | 86.3 / 85.5 | 84.9 / 84.5 | 82.2 / 83.0 | 78.5 / 80.3 |
| a1a-w20 | 72.2 / 63.1 | 72.7 / 63.4 | 71.7 / 63.2 | 70.8 / 63.1 | 67.1 / 60.0 |
| a1b-single | 68.6 / 66.3 | 69.1 / 68.5 | 77.8 / 79.4 | 79.8 / 81.9 | 81.0 / 83.2 |
| a2-bare | 81.9 / 81.7 | 83.7 / 83.1 | 80.8 / 81.4 | 78.1 / 79.5 | 74.5 / 77.4 |
| a2-ledger | 80.4 / 81.1 | 85.4 / 85.2 | 84.5 / 84.6 | 82.3 / 83.7 | 80.4 / 82.7 |
| a2-quote | 75.4 / 73.8 | 78.8 / 78.3 | 81.9 / 81.6 | 81.9 / 82.3 | 82.2 / 83.5 |
| a2-tag | 82.2 / 82.3 | 85.5 / 84.8 | 85.0 / 84.7 | 83.1 / 84.0 | 78.6 / 80.5 |
| a4-tree | 84.4 / 84.7 | 86.5 / 86.1 | 84.1 / 84.5 | 78.3 / 80.8 | 73.1 / 76.7 |
### How the labels are read from the probabilities (window of 20 units, exclusive wording, 3 runs)

| Decoding rule | acc @0.3 / F1 @0.3 | acc @0.4 / F1 @0.4 | acc @0.5 / F1 @0.5 | acc @0.6 / F1 @0.6 | acc @0.7 / F1 @0.7 |
|---|---|---|---|---|---|
| highest probability above the threshold | 84.1 / 83.9 | 86.3 / 85.5 | 84.9 / 84.5 | 82.2 / 83.0 | 78.5 / 80.3 |
| first above the threshold in the order gate > prohibition > rule > example > description | 73.7 / 74.6 | 80.7 / 80.5 | 81.9 / 81.8 | 80.9 / 81.7 | 78.6 / 80.7 |
### Per class, best arm (150 questions per call, 3 runs, threshold 0.5)

| Class | Gold units | Precision, % | Recall, % | F1, % |
|---|---|---|---|---|
| rule | 69 | 76.5 | 85.0 | 80.5 |
| prohibition | 42 | 95.2 | 95.2 | 95.2 |
| gate | 46 | 86.1 | 71.0 | 77.8 |
| example | 29 | 91.2 | 95.4 | 93.3 |
| description | 124 | 95.7 | 83.3 | 89.1 |
| none | 85 | 80.7 | 94.9 | 87.2 |
### Arm 5: linking (one question per unit and block, 3 runs each, 20 blocks, 37 true links)


| Variant | Calls per block | Calls for 20 blocks | P / R @0.3 | P / R @0.4 | P / R @0.5 | P / R @0.6 | P / R @0.7 | P / R @0.8 | P / R @0.9 |
|---|---|---|---|---|---|---|---|---|---|
| a5-link-all-100 | 4 | 80 | 15.7 / 100.0 | 23.4 / 97.3 | 31.8 / 97.3 | 40.1 / 94.6 | 57.0 / 91.9 | 74.1 / 90.1 | 93.5 / 64.0 |
| a5-link-all-all | 1 | 20 | 21.0 / 100.0 | 26.6 / 99.1 | 35.1 / 95.5 | 43.8 / 91.9 | 59.0 / 89.2 | 74.6 / 84.7 | 85.4 / 57.7 |
| a5-link-instructions-all | 1 | 20 | 50.2 / 100.0 | 59.3 / 94.6 | 69.6 / 94.6 | 81.1 / 92.8 | 91.1 / 91.9 | 94.1 / 86.5 | 96.1 / 66.7 |

| Variant | F1 @0.3 | F1 @0.4 | F1 @0.5 | F1 @0.6 | F1 @0.7 | F1 @0.8 | F1 @0.9 |
|---|---|---|---|---|---|---|---|
| a5-link-all-100 | 27.1 | 37.8 | 47.9 | 56.3 | 70.4 | 81.3 | 75.9 |
| a5-link-all-all | 34.7 | 41.9 | 51.3 | 59.3 | 71.0 | 79.3 | 68.8 |
| a5-link-instructions-all | 66.9 | 72.9 | 80.2 | 86.6 | 91.5 | 90.1 | 78.7 |

| Label first, then link | Labelling runs | Candidates kept (runs 1, 2, 3) | Calls, 20 blocks | P / R @0.3 | P / R @0.4 | P / R @0.5 | P / R @0.6 | P / R @0.7 | P / R @0.8 | P / R @0.9 |
|---|---|---|---|---|---|---|---|---|---|---|
| predicted class is rule, prohibition or gate (threshold 0.5) | a3-q150-r1, a3-q150-r2, a3-q150-r3 | 155, 159, 156 | 14 labelling + 20 linking | 43.4 / 97.3 | 51.0 / 96.4 | 59.6 / 92.8 | 66.9 / 89.2 | 82.1 / 86.5 | 90.1 / 82.0 | 92.7 / 57.7 |
| any of rule, prohibition, gate has probability 0.5 or more | a3-q150-r1, a3-q150-r2, a3-q150-r3 | 161, 164, 162 | 14 labelling + 20 linking | 41.9 / 97.3 | 49.5 / 96.4 | 58.2 / 92.8 | 66.1 / 89.2 | 82.1 / 86.5 | 90.1 / 82.0 | 92.7 / 57.7 |

| Label first, then link | F1 @0.3 | F1 @0.4 | F1 @0.5 | F1 @0.6 | F1 @0.7 | F1 @0.8 | F1 @0.9 |
|---|---|---|---|---|---|---|---|
| predicted class is rule, prohibition or gate (threshold 0.5) | 60.0 | 66.7 | 72.5 | 76.5 | 84.2 | 85.8 | 71.1 |
| any of rule, prohibition, gate has probability 0.5 or more | 58.6 | 65.4 | 71.5 | 75.9 | 84.2 | 85.8 | 71.1 |

### Arm 5: links missed or wrong in all 3 runs at 0.5 (one call per block, all 395 units)


| Block | True links | Missed in all runs | Wrong in all runs |
|---|---|---|---|
| b01 closing-order | 2 | none | [69] none; [71] prohibition |
| b02 overnight-warmth | 1 | none | [65] description; [69] none; [70] gate; [72] rule |
| b03 last-out | 2 | none | [82] none; [84] rule; [87] none; [89] rule; [153] description; [392] rule |
| b04 food-bank-sacks | 2 | none | [8] prohibition; [10] rule |
| b05 yellow-flame | 1 | none | [232] description; [257] description; [259] rule |
| b06 gas-smell | 1 | none | [263] description; [264] description; [265] rule |
| b07 hot-deck-spray | 2 | none | [232] description; [242] none |
| b08 dough-mix-order | 2 | none | [123] rule; [126] example |
| b09 starter-evening | 1 | none | none |
| b10 cream-cake-level | 1 | none | [314] none |
| b11 new-loaf-launch | 4 | none | [4] description; [8] prohibition; [172] none; [174] gate; [176] example; [320] example |
| b12 party-order-call | 3 | none | [208] description; [209] none; [211] rule; [214] description; [215] example; [217] rule; [218] rule |
| b13 allergen-question | 3 | none | [9] example; [11] none |
| b14 walnut-bake | 1 | none | [19] prohibition |
| b15 delivery-door | 3 | none | [96] none; [101] example |
| b16 torn-sack | 1 | none | [108] none; [109] rule; [112] description; [113] example |
| b17 own-void | 2 | none | [369] description; [385] none; [387] gate; [389] example |
| b18 late-christmas | 2 | [286] | [268] description; [284] none |
| b19 shift-swap | 2 | none | [350] prohibition |
| b20 broken-glass-bag | 1 | none | [58] none; [62] description |

### Arm 6: run-to-run agreement (3 runs of each arm, threshold 0.5)


| Variant | Runs | Same label in two runs, % (mean pair) | Cohen kappa | Question-level yes/no flips between runs, % | Mean absolute probability difference | Accuracy of the mean of the runs, % | Macro F1 of the mean, % |
|---|---|---|---|---|---|---|---|
| a1a-w20-defs2 | 3 | 96.7 | 0.959 | 1.4 | 0.017 | 84.8 | 84.2 |
| a1a-w20 | 3 | 96.3 | 0.949 | 1.1 | 0.016 | 72.4 | 64.2 |
| a1b-single | 3 | 96.1 | 0.951 | 1.5 | 0.015 | 78.0 | 79.8 |
| a2-bare | 3 | 96.6 | 0.957 | 1.4 | 0.021 | 80.8 | 81.4 |
| a2-ledger | 3 | 97.3 | 0.966 | 1.0 | 0.017 | 84.8 | 85.3 |
| a2-quote | 3 | 97.0 | 0.962 | 1.5 | 0.015 | 82.0 | 81.7 |
| a2-tag | 3 | 97.1 | 0.964 | 1.6 | 0.018 | 84.8 | 84.4 |
| a3-q150 | 3 | 97.8 | 0.972 | 1.2 | 0.017 | 87.1 | 87.6 |
| a3-q250 | 3 | 98.0 | 0.974 | 0.8 | 0.019 | 86.3 | 87.4 |
| a4-tree | 3 | 94.2 | 0.927 | 4.5 | 0.045 | 85.3 | 85.7 |
