# Phase 2: can Jev label units above 99%?

Short answer: **no, not on this set.** The best design reaches 96.4% on the accepted units of the 5 test files with 17.6% abstained, and 99.1% only on the 540 units both annotators labelled alike (15.9% abstained). Jev alone reaches 86.1% with no abstention, and 95.8% with 30% abstained. The numbers and the reasons are below. Every number comes from a file in this folder: `results2/` (runs), `cassette2.jsonl.gz` and `cassette2-haiku.jsonl.gz` (every answer), `an4.out.txt`, `an5.out.txt`, `agree.out.txt`, `tables2.out.md` (printed by `tables2.ts`).

## Step 0: what the literature says (searched this session, 7 queries)

I read the search summaries, not the full papers. Each line says what I used it for.

- Self-consistency: sample several answers and keep the most frequent one. Wang et al., ICLR 2023, [arXiv 2203.11171](https://arxiv.org/pdf/2203.11171v2). Reported gains are on reasoning tasks. Used for arm c (3 paraphrases, probabilities averaged).
- Decomposition: split a task into simpler sub-tasks, each with its own prompt, combine in code. Khot et al., ICLR 2023, [arXiv 2210.02406](https://arxiv.org/pdf/2210.02406). Used for arm b.
- Selective prediction: a classifier that may reject. Geifman and El-Yaniv, ICML 2019, [SelectiveNet](https://proceedings.mlr.press/v97/geifman19a.html), reports a risk-coverage trade-off. Used for the abstain rule and the risk-coverage numbers.
- Calibration: modern networks are poorly calibrated, and a small post-hoc scaling fixes much of it. Guo et al., ICML 2017, [PMLR v70](https://proceedings.mlr.press/v70/guo17a.html). Zhao et al., ICML 2021, [Calibrate Before Use](https://proceedings.mlr.press/v139/zhao21c): few-shot LLM accuracy swings with prompt wording and answer bias, and a calibration step stabilises it. Used for the stacker (a logistic regression on the recorded probabilities).
- Models know when they are unsure: Kadavath et al. 2022, [arXiv 2207.05221](https://arxiv.org/pdf/2207.05221): P(True) is well calibrated on true/false questions in the right format. Supports using Jev's yes/no probability as a confidence.
- Cascades: a cheap model answers, a stronger one takes the uncertain cases (FrugalGPT and AutoMix are described in the search results; I did not open them). Used for arm e. A secondary result I found says cascades differ from abstention: they pick a model rather than refuse.
- Not retrieved: Chow 1970 (reject option), and any paper on yes/no decomposition for text classification with a measured accuracy. No claim here rests on them.

## Step 1: the held-out set

- Fictional harbour co-op ("Tidewick"), 8 markdown files written fresh: a standing-instructions file, 3 skills, a helper definition, a memory-notes file, a tool reference, a night-shift handover. **597 units** cut by the prototype cutter (`../src/cut.ts`): sentences, list items, table cells, headings, front-matter values. Source with the author's tags: `prose-src/`; clean files: `prose/`.
- Shapes from the miss list, written as new sentences: rule after a dash or semicolon, rule as the second sentence after a bold label, prohibition inside a sentence, short list items with no end mark, rules in table cells, arrow conditions, a hard-wrapped sentence, a declarative duty with no modal, look-alike descriptions (what a tool always or never does; "Use X when you need Y" summaries; a bold lead holding a clause).
- Labels: rule, prohibition, gate, example, description, none. Written guide: `GUIDE.md` (priority example > prohibition > gate > rule > description > none; an instruction counts wherever it sits in the unit).
- **Two annotators.** A: me, tagging each unit while writing it. B: a fresh Haiku subagent given only `GUIDE.md` and a sheet of the units, not my tags. Agreement before any adjudication:


- Agreement: 540 of 597 units (**90.5%**), Cohen kappa **0.870**. A (rows) against B (columns):

| A \ B | rule | prohibition | gate | example | description | none |
|---|---|---|---|---|---|---|
| rule | 139 | 13 | 9 | 3 | 10 | 0 |
| prohibition | 0 | 32 | 0 | 0 | 1 | 0 |
| gate | 1 | 0 | 16 | 0 | 0 | 0 |
| example | 0 | 0 | 0 | 23 | 0 | 0 |
| description | 3 | 3 | 0 | 2 | 212 | 5 |
| none | 0 | 0 | 0 | 1 | 6 | 118 |

- Where they differ: a rule that also forbids ("ask nothing else") or orders ("then") counts as prohibition or gate under the priority; I tagged some of those as rule. List items that are bare noun phrases, a front-matter description, "Use X when..." lines, and a table cell like "Not within 90 minutes of low water" are the contested edge.
- **Adjudication.** The 57 differing units were settled by me against `GUIDE.md`, without seeing any model output: B stands except for 16 listed overrides (`freeze.ts`). Final gold: `gold2.json`, sha256 in `gold2.sha256` (`34bb813e...5609`), committed before the first Jev call. Each unit carries `contested` (A and B differed). Final gold agrees with A on 555 units and with B on 581.
- **Bias to know.** B is a Haiku model and the second labeller below is `claude-haiku-5-5`. The adjudication leans to B. This can raise Haiku's score on the full gold. The "agreed" subset (540 units, both annotators alike) is not affected by the adjudication, so I report it next to the full set.
- Split: **dev** = the first 3 files (222 units: standing instructions, refund desk, tide tables); **test** = the other 5 files (375 units). Thresholds were picked on dev only. No question wording was edited after any result was seen; each wording ran once as first written.

## Spend

- Jev: **615 calls** (0 failed, limit 3,000), 4,980,054 input and 1,674,507 output tokens (`spend2-jev.json`). USD unknown: no price on file.
- Haiku `claude-haiku-5-5`: **54 calls**, 97,758 input and 66,750 output tokens (`spend2-haiku.json`). I have no price on file for it. Even at an assumed 5 USD per million input and 25 USD per million output tokens (above any Haiku list price I know of, an assumption) the cost is under 2.2 USD, below the 5 USD cap.
- Keys: read from `~/.nexus-secrets`, never printed. The two cassettes hold no key, no header and no `Authorization` text (checked by searching for the key text and its first 12 characters).
- Replay: `JEV_MODE=replay ./run2.sh <variant>:<run>` and `JEV_MODE=replay pnpm exec tsx jev-experiments/run2h.ts <run>` rebuild a result from the cassettes with no network and no key; after a replay of one Jev run and one Haiku run, `tables2.ts` printed the identical tables.

## Results

All accuracy figures are **accuracy on accepted units**, in %, with the abstain rate in brackets or in the row name. Gold = the adjudicated gold. "Test" is the clean column (5 files never used for choosing a threshold).

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


## What the numbers say

- **The phase 1 design does not hold on realistic prose.** Arm 0 (the same questions as phase 1) scored 84.9% on the planted bakery estate; on this set it scores 74.4% on all units, 77.6% on test. Short, imperative, one-label planted sentences were easy.
- **Wording changes move accuracy by a few points, not by 20.** Single passes on test: arm 0 77.1, arm a (rules with contrastive examples) 76.4, arm d0 (no heading lines) 77.2, arm d2 (heading lines and file role) 77.0, arm b (decomposed) 72.6, arm c (3 paraphrases) 79.9. Passes of one arm differ by at most 2.5 points. So: contrastive examples, extra context and decomposition each give nothing measurable alone; only averaging paraphrases helps (+2 to +3). Arm a costs 3 times the input tokens of arm 0.
- **Arm b (decomposition) hurts when combined by a fixed chain in code** (72.3). Its sub-answers are separable on average (first pass: for gold prohibition units the "forbids" answer averages 0.82, for rule units 0.28), but the false yes rate on "orders" and "forbids" is high enough that the chain misfires. Its probabilities still help inside the stacker (arm b alone: 72.3 raw, 80.5 stacked).
- **The largest gain is calibration.** A logistic regression on the recorded probabilities, trained on the other files (leave-one-file-out), lifts arm 0 from 77.6 to 78.4, arm c from 80.8 to 82.7, and all designs together to **86.1** on test (86.3 on all, 90.2 on agreed). Calibration also makes the confidence useful: abstaining the lowest 30% gives **95.8%** on test.
- **Abstaining works but is expensive.** On the stacker, 99% accuracy holds only for the most confident 28% to 34% of units (`an4.out.txt`).
- **Haiku is a stronger reader than Jev here:** 90.4% (one run) and 91.5% (majority of 3) on test, 92.1% on all, 94.6% on agreed (with the bias above). When its 3 runs agree (unanimous, 93.9% of test units) it is right 94.6% of the time on test.
- **Jev and Haiku together:** one stacker over the Jev probabilities and Haiku's vote counts reaches 92.8% on test with no abstention, 95.5% at 10.7% abstained, 96.6% at 14.9%, 97.0% at 19.7%. 99% accuracy holds for the most confident 55% to 58% of units (82% on the agreed subset). "Accept only if the Jev stacker equals a unanimous Haiku" gives 96.4% on test at 17.6% abstained and **99.1% on the agreed subset at 15.9% abstained**.
- **The cascade as specified (arm e) adds little over Haiku alone** when the first labeller is raw Jev: the margin of raw Jev does not separate its right and wrong answers, so every margin that keeps accuracy sends 99% of units to Haiku (94.6% on test, 6.1% abstained = Haiku unanimous alone). With the calibrated stacker as first labeller only 26% to 60% of units reach Haiku for the same accuracy (93.7 to 94.7).
- **The 99% target is above what the labels can show.** The two annotators agree on 90.5% of units (kappa 0.870). With the best combined stacker at 10% abstained (537 accepted units), 22 are wrong: 10 of them are units the annotators disputed, 12 are not. Those 12 are mostly boundary calls a reader can argue either way (a front-matter description such as "Prepare a refund hand-over... Use when...", a table cell "Not within 90 minutes of low water", "The date the notice was written and the initials of the clerk.", "The clerk signs the log line and the customer signs beside it."). Measuring 99% needs a gold whose own disagreement is well under 1%; this one is 9.5%.

## What design this points to

- **Do not rely on Jev alone for prose.** Raw Jev is 74% to 81%. Treat its probabilities as features, not as labels.
- **Calibrate on a labelled set from the same estate.** Seven designs (arms 0, a, b, c, d) run 3 times each, then a logistic regression, give 86%. Cost: 615 Jev calls for 597 units (about 1 call per unit). It needs labelled units from other files; leave-one-file-out shows it transfers across files of one estate.
- **Add a second reader and stack.** Haiku with the written guide, 3 runs, 54 calls for 597 units (about 0.1 call per unit, about 165k tokens), brings the stacker from 86% to 93% with no abstention.
- **Abstain on the weakest 15% to 20% and send them to a person.** 96.6% to 97.0% on test; 98.1% to 98.7% on the agreed subset. On the full gold, 99% on accepted units needs about 42% to 45% abstained (the most confident 55% to 58% of units), or a rubric that leaves fewer disputed units.
- **Fix the rubric before spending more on models.** The disputed units are the same few shapes (list noun phrases, table cells, front-matter descriptions, "use X when" lines, ordering inside a rule). Writing a decision for each shape into the label set (a default label per shape, stated once) would remove most of the 9.5% disagreement, and every labeller gets easier.
- **Keep the ledger.** The probabilities and votes are cached per unit fingerprint, so a changed file re-labels only its changed units.

## Limits

- One estate (8 files, 597 units), fictional, written by one author. The gold has noise on the order of 5% (annotator agreement 90.5%).
- Dev files are 3 and test files 5; two of five test files (the helper definition and the tool reference) have table-heavy or example-heavy layouts. A different estate may behave differently.
- The stacker is trained on labels of the other files of the same estate. On a new estate it needs its own labelled units.
- B is a Haiku model and the second labeller is `claude-haiku-5-5`. Same-family agreement can overstate Haiku's accuracy on the full gold; the agreed subset limits that.
- Jev answers are not deterministic: three passes of the same questions differ by up to 2.5 points on test. The cassette fixes them.

## Files

`GUIDE.md` (labelling guide) · `prose-src/` (sources with the author's tags) · `prose/` (clean files) · `annot-b.tsv` (annotator B) · `disagreements.tsv` · `gold2.json`, `gold2.sha256`, `gold2.author.json` · `build-prose.ts`, `sheet.ts`, `agree.ts`, `freeze.ts` · `src/p2.ts` (questions per arm), `src/dec2.ts` (decoders and metrics), `src/stack.ts` (stacker), `src/haiku.ts` · `run2.ts`, `run2.sh`, `run2h.ts` · `an2.ts`, `an2b.ts`, `an2h.ts`, `an3.ts` (earlier looks, kept), `an4.ts`, `an5.ts`, `tables2.ts` · `results2/`, `cassette2.jsonl.gz`, `cassette2-haiku.jsonl.gz`, `spend2-*.json`, `an4.out.txt`, `an5.out.txt`, `tables2.out.md`.
