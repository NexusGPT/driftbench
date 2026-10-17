# Phase 3: a rule can be a whole paragraph (spans, nested units)

Short answer: **grouping is the missing piece, and Jev can do it, but not near 99%.** Labelling each unit alone gives the right class to only 42% of the units that sit inside a multi-unit rule, and its exact-span F1 is 47% (all 9 files). With grouping questions and a small calibrated regression, Jev alone reaches **72%** exact-span F1 over all 9 files (pair design: 95% interval over files 61% to 81%), and Jev with Haiku votes as extra features reaches **79% to 84%**. An independent annotator (a fresh Haiku with the written guide) scores 82% against the same gold, so the gold itself does not support a 99% claim. Every number below comes from a file in this folder: `results3/` (runs), `cassette3.jsonl.gz` and `cassette3-haiku.jsonl.gz` (every answer), and the `.out` files named in each section.

## What the owner's correction asked, and where it is

| # | Ask | What was done | Where |
|---|---|---|---|
| 1 | Nested units, each with its own id | A tree per file: file, front matter, section, paragraph, list, blockquote, table, table row, plus 10 lead-in groups (a paragraph directly followed by a list or table). 329 non-leaf nodes and 566 sentence-level units, 895 ids, all distinct. Ids use the ledger rule: hash of (estate key, file and node kind, fingerprint, occurrence). | `src/tree.ts`, `nodes3.json`, `gold3.json` (unit ids) |
| 2 | A rule can be any level or a span of units | Gold rule = a list of consecutive unit ids with one kind (rule, prohibition or gate). 86% of the multi-unit rules (63 of 73) equal an existing node (paragraph 36, table row 20, lead-in group 7); 10 are part of a block, so a node id alone cannot name every rule. | `spans3.json` |
| 3 | Gold marks each rule as a span; at least 30% span several units | 174 rules, **73 (42.0%) span several units**: 24 of 56 on the dev files (42.9%), 49 of 118 on the test files (41.5%). | `gold3.json` (`rules`), `spans3.json` |
| 4 | Arm (g): top-down, ask per paragraph or list "is this one instruction?", descend only when no | Arm g: Jev answers "is the whole paragraph / list / table row / lead-in group ONE instruction?" for all 240 blocks; blocks above a threshold become spans; the units outside accepted blocks keep their per-unit labels. Arm h (mine): bottom-up, Jev answers "do these two neighbour units belong to the same instruction?" for 541 pairs and code merges. g2 = g then h. | `src/p3.ts`, `src/lib3.ts` |
| 5 | Score span accuracy separately: exact match, partial overlap | Every table gives per-unit accuracy and, beside it, exact-span precision, recall and F1, exact-plus-kind F1, IoU >= 0.5 precision and recall, any-overlap recall, and exact recall of multi-unit and single-unit rules. | `src/spans.ts` |

## The span corpus

- Fictional volunteer repair cafe ("Hollin Vale"), 9 markdown files written fresh: a standing-instructions file, 4 skills, a helper definition, a memory-notes file, a tool reference, a session handbook, a replies guide. **566 units**, cut by the prototype cutter. Sources with the author's tags: `prose3-src/`; clean files: `prose3/`.
- Dev = the first 3 files (175 units, 56 rules); test = the other 6 files (391 units, 118 rules). Thresholds are chosen on dev only.
- Labels per unit: description 165, none 104, rule 140, prohibition 83, gate 56, example 18. Rule kinds (174 rules): rule 91, prohibition 53, gate 30. Span shapes written on purpose: a lead-in sentence and its list items; a table row whose cells together say what to do; a condition sentence followed by its action; a rule followed by its exception; a rule followed by a sentence that gives its detail; a paragraph with two sentences that cannot be followed apart. Look-alikes next to them: a background sentence in the same paragraph, an example, a tool description.
- **Two annotators.** A: me, tagging each unit while writing. B: a fresh Haiku subagent given only `GUIDE3.md` (labels plus the rule-as-span definition) and a sheet that shows each file's structure; it saw none of my tags. Agreement before adjudication (`agree3.out.txt`, `disagreements3.tsv`, `span-disagreements3.txt`):

```
per-unit label: 566 units, agree 453 (80.0%), kappa 0.748
A\B rule	prohibition	gate	example	description	none
rule 114	27	19	2	2	0
prohibition 3	65	3	0	0	0
gate 1	2	35	1	0	0
example 0	0	0	17	0	0
description 34	10	3	1	118	4
none 0	0	0	0	1	104
rules: A 173 (multi 69), B 200 (multi 79)
span exact (A as gold, B as prediction): P 71.0 R 82.1 F1 76.1; with kind F1 63.3; IoU>=0.5 R 97.7 P 86.5; any overlap R 97.7
multi-unit rules only: exact F1 79.7 (R 85.5, P 74.7)
instruction vs not agree 90.8%
```

- Per-unit label agreement 80.0% (kappa 0.748). Instruction against not-instruction: 90.8%. Rules: A 173 (69 multi-unit), B 200 (79 multi-unit). Exact-span F1 of B against A: 76.1%; on multi-unit rules only 79.7%; IoU >= 0.5 recall 97.7%. The annotators agree on where a rule is far more often than on its exact edges and kind.
- **Adjudication** (`freeze3.ts`, every decision listed in the script): B's label stands on 5 units, my label stands on all other differences; 3 of my groups were dropped and 7 of B's groups added; the kind of 19 groups was decided against the guide and 2 units were set to description. 129 units and 47 rules are marked `contested`. The frozen gold agrees with A on 521 of 566 units and with B on 493. sha256 `dece89d68125e302f5c16ff9714b4be11a48b751fa04dd4bcc1939268932a7f8` (`gold3.sha256`), committed in `65f9255e4` before the first Jev call of this phase.
- Annotators against the frozen gold (`an11.out.txt`). A wrote the gold, so its row is not a fair ceiling; B's row is:

```
annotator A (author tags) against the frozen gold    dev   per-unit acc 94.3 (outside 99.1, inside 86.2) exact P 100.0 R 98.2 F1 99.1 IoU.5 P 100.0 R 98.2 anyR 98.2 multi exactR 100.0 single exactR 96.9
annotator A (author tags) against the frozen gold    test  per-unit acc 91.0 (outside 97.8, inside 74.3) exact P 90.7 R 90.7 F1 90.7 IoU.5 P 99.2 R 100.0 anyR 100.0 multi exactR 85.7 single exactR 94.2
annotator A (author tags) against the frozen gold    all   per-unit acc 92.0 (outside 98.2, inside 78.7) exact P 93.6 R 93.1 F1 93.4 IoU.5 P 99.4 R 99.4 anyR 99.4 multi exactR 90.4 single exactR 95.0
annotator B (fresh Haiku) against the frozen gold    dev   per-unit acc 93.1 (outside 93.6, inside 92.3) exact P 82.3 R 91.1 F1 86.4 IoU.5 P 93.5 R 100.0 anyR 100.0 multi exactR 87.5 single exactR 93.8
annotator B (fresh Haiku) against the frozen gold    test  per-unit acc 84.4 (outside 80.6, inside 93.8) exact P 73.9 R 86.4 F1 79.7 IoU.5 P 82.6 R 96.6 anyR 96.6 multi exactR 91.8 single exactR 82.6
annotator B (fresh Haiku) against the frozen gold    all   per-unit acc 87.1 (outside 84.3, inside 93.3) exact P 76.5 R 87.9 F1 81.8 IoU.5 P 86.0 R 97.7 anyR 97.7 multi exactR 90.4 single exactR 86.1
```

## The designs

Window shown to Jev: the file's structure as a tree, with the units numbered `[n]` inside blocks that carry display ids. Excerpt (`run3.ts show 3`):

```
[P31] PARAGRAPH
  [64] This skill creates the ticket that follows an item through the cafe.
  [65] It does not book a bench and it does not promise a repair.
[66] ## Steps
[L32] LIST
  [67] Ask for the visitor's name and phone number.
  ...
[T34] TABLE
  [R36] ROW
    [80] Mains appliance
    [81] A plug or a cable
    [82] Book a bench with a volunteer who holds the mains badge
```

Windows hold 7 to 31 units (median 25) and never split a lead-in paragraph from its list or table; 25 windows cover the corpus.

- **Per-unit labellers** (the phase 2 questions on this corpus: arms 0, a, b, c, d, and the stacker). The "descent" labeller gives each unit outside an accepted block its class.
- **s0**: per-unit labels only; every instruction unit is its own span.
- **g, top-down**: block question. Wording 1: "Is the whole paragraph [P31] ONE single instruction (what to do, what never to do, or in which order)? Answer yes only if everything in it belongs to that one instruction ...". The "range" wording asks about "units [64] to [65] of the window" instead of the display id. Accepted blocks are taken by decreasing probability, overlaps skipped, a `none` unit at either edge trimmed. Kind of a span = strongest kind among its units.
- **h, bottom-up**: "Do units [a] and [b] of the window belong to the same instruction ...?" for each pair of neighbours; adjacent units with a probability at or above the threshold are merged by union-find, only if at least one of the two is an instruction.
- **g2**: g first, then h on what g left.
- **-cal**: the same questions, but the accept/merge decision is a small logistic regression (L2 0.03) over the Jev probabilities (block question, pair question, unit class vectors of both units) and structure (same paragraph, same row, same lead-in group, container kinds). Trained on the files other than the one it predicts ("lofo-all": each file is predicted by a model trained on the other 8 files) or on the 3 dev files only ("dev-train"). No word list is used anywhere.
- **Jev + Haiku features**: the unit stacker, the regressions and the pair features also take Haiku vote fractions and Haiku's own "same group" votes (3 runs of `claude-haiku-5-5` with `GUIDE3.md`, one call per file).
- The unit stacker is trained on the *other* corpus (phase 2's harbour co-op, `gold2.json`) and applied here, so no label of this corpus enters it. Phase 2's Haiku features came from another guide; this is a mismatch, kept as is.

## Results

How to read the tables: "Per-unit acc" has three numbers: all units, units outside multi-unit rules, units inside multi-unit rules. A unit inside a multi-unit rule has the rule's kind as its gold label (for example a table cell "Mains appliance" in a row that says what to do). "Exact" means the predicted set of units equals a gold rule. "IoU >= 0.5" counts a predicted span as right if it shares at least half of the union with a gold rule. "Any-overlap R" is the share of gold rules that share at least one unit with some predicted span. "Exact + kind F1" also requires the same kind. Thresholds were chosen on the dev files by exact-span F1.

**Test files were not blind.** While building the calibration features I looked at test-file numbers. The dev files hold only 56 rules, and the order of designs differs between dev and test (see dev tables in `tables3.out.md`). The most stable figures are over all 9 files, where every file is predicted by a model that did not train on it; thresholds still came from the 3 dev files, so those figures are slightly optimistic.

### Per-unit labellers alone, on this corpus (`an12.out.md`)

| Per-unit labeller | All units, test acc % | Outside multi-unit rules | Inside multi-unit rules | All units, dev acc % |
|---|---|---|---|---|
| 0 baseline wording (t=0.4) | 68.3 | 77.7 | 45.1 | 62.3 |
| a rules + contrastive examples (t=0.4) | 65.0 | 74.8 | 40.7 | 64.6 |
| d0 no heading lines (t=0.5) | 66.2 | 75.9 | 42.5 | 64.6 |
| d2 heading lines + file role (t=0.4) | 67.5 | 75.9 | 46.9 | 64.0 |
| b decomposed sub-questions (t=0.7) | 64.7 | 73.7 | 42.5 | 61.1 |
| c three paraphrases averaged (t=0.5) | 71.1 | 81.3 | 46.0 | 68.0 |
| Stacker over all Jev designs, trained on the other corpus (no label of this corpus) | 77.7 | 91.7 | 43.4 | 70.9 |
| Stacker over all Jev designs, leave-one-file-out on this corpus (8 files of labels) | 76.2 | 86.0 | 52.2 | 75.4 |
| Haiku, span guide, majority of 3 (3 calls per file) | 83.6 | 87.4 | 74.3 | 89.7 |

Per-unit labelling is good where a unit is an instruction by itself (91.7% outside multi-unit rules with the transferred stacker) and weak inside multi-unit rules (43.4%): a lead-in sentence, a table cell or an "if X" sentence is not an instruction on its own.

### Span designs, Jev only: test files (6 files, 118 rules)

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 77.7 / 91.7 / 43.4 | 44.0 / 55.9 / **49.3** | 47.8 | 78.0 / 88.1 | 95.8 | 0.0 / 95.7 | 150 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 76.2 / 79.9 / 67.3 | 51.4 / 64.4 / **57.1** | 54.1 | 78.4 / 94.9 | 98.3 | 49.0 / 75.4 | 148 (49) |
| g: top-down, block question (range wording) (t=0.4) | 75.7 / 81.3 / 61.9 | 51.3 / 66.1 / **57.8** | 54.8 | 76.3 / 93.2 | 97.5 | 38.8 / 85.5 | 152 (37) |
| h: bottom-up, pair question (t=0.8) | 82.4 / 91.0 / 61.1 | 62.5 / 72.0 / **66.9** | 63.0 | 83.8 / 92.4 | 95.8 | 46.9 / 89.9 | 136 (33) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 78.0 / 80.9 / 70.8 | 59.6 / 73.7 / **65.9** | 62.1 | 80.1 / 96.6 | 97.5 | 59.2 / 84.1 | 146 (52) |
| g-cal: block question + calibrated regression (t=0.4) | 80.6 / 84.2 / 71.7 | 69.0 / 75.4 / **72.1** | 66.4 | 88.4 / 96.6 | 97.5 | 67.3 / 81.2 | 129 (48) |
| h-cal: pair question + calibrated regression (t=0.5) | 84.7 / 90.3 / 70.8 | 80.2 / 82.2 / **81.2** | 74.5 | 91.7 / 95.8 | 95.8 | 77.6 / 85.5 | 121 (46) |
| g2-cal: both, calibrated (t=0.4/0.7) | 80.6 / 84.2 / 71.7 | 69.0 / 75.4 / **72.1** | 66.4 | 88.4 / 96.6 | 97.5 | 67.3 / 81.2 | 129 (48) |

### Span designs, Jev only: all 9 files (174 rules)

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 75.6 / 91.0 / 42.1 | 41.3 / 54.6 / **47.0** | 45.5 | 72.6 / 83.3 | 95.4 | 0.0 / 94.1 | 230 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 75.6 / 81.2 / 63.5 | 52.0 / 66.1 / **58.2** | 53.7 | 76.0 / 92.5 | 97.7 | 50.7 / 77.2 | 221 (67) |
| g: top-down, block question (range wording) (t=0.4) | 75.8 / 83.0 / 60.1 | 52.9 / 67.8 / **59.4** | 55.4 | 74.4 / 90.8 | 97.1 | 43.8 / 85.1 | 223 (53) |
| h: bottom-up, pair question (t=0.8) | 80.6 / 89.7 / 60.7 | 56.7 / 68.4 / **62.0** | 58.3 | 80.0 / 90.2 | 95.4 | 39.7 / 89.1 | 210 (51) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 78.3 / 82.5 / 69.1 | 59.3 / 73.6 / **65.6** | 61.0 | 78.7 / 95.4 | 97.1 | 60.3 / 83.2 | 216 (76) |
| g-cal: block question + calibrated regression (t=0.4) | 80.2 / 84.8 / 70.2 | 68.0 / 77.0 / **72.2** | 65.2 | 83.8 / 94.8 | 97.1 | 72.6 / 80.2 | 197 (72) |
| h-cal: pair question + calibrated regression (t=0.5) | 82.7 / 89.4 / 68.0 | 70.5 / 74.1 / **72.3** | 66.1 | 86.9 / 92.5 | 95.4 | 67.1 / 79.2 | 183 (72) |
| g2-cal: both, calibrated (t=0.4/0.7) | 80.2 / 84.8 / 70.2 | 68.0 / 77.0 / **72.2** | 65.2 | 83.8 / 94.8 | 97.1 | 72.6 / 80.2 | 197 (72) |

### Span designs, Jev with Haiku votes as features: test files

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 80.3 / 93.2 / 48.7 | 41.0 / 57.6 / **47.9** | 45.1 | 74.7 / 90.7 | 98.3 | 0.0 / 98.6 | 166 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 77.0 / 81.3 / 66.4 | 51.6 / 66.9 / **58.3** | 53.1 | 77.1 / 96.6 | 100.0 | 51.0 / 78.3 | 153 (50) |
| g: top-down, block question (range wording) (t=0.4) | 76.5 / 83.1 / 60.2 | 51.9 / 68.6 / **59.1** | 54.0 | 75.6 / 94.9 | 99.2 | 40.8 / 88.4 | 156 (38) |
| h: bottom-up, pair question (t=0.6) | 79.0 / 83.5 / 68.1 | 68.9 / 69.5 / **69.2** | 61.6 | 91.6 / 95.8 | 99.2 | 69.4 / 69.6 | 119 (65) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 78.5 / 82.4 / 69.0 | 60.8 / 76.3 / **67.7** | 61.7 | 80.4 / 98.3 | 99.2 | 61.2 / 87.0 | 148 (53) |
| g-cal: block question + calibrated regression (t=0.2) | 80.3 / 83.1 / 73.5 | 72.7 / 78.8 / **75.6** | 66.7 | 88.3 / 98.3 | 99.2 | 79.6 / 78.3 | 128 (60) |
| h-cal: pair question + calibrated regression (t=0.4) | 85.7 / 91.4 / 71.7 | 78.9 / 85.6 / **82.1** | 71.5 | 92.2 / 98.3 | 98.3 | 83.7 / 87.0 | 128 (48) |
| g2-cal: both, calibrated (t=0.2/0.4) | 80.6 / 82.7 / 75.2 | 73.4 / 79.7 / **76.4** | 67.5 | 88.3 / 98.3 | 99.2 | 83.7 / 76.8 | 128 (63) |

### Span designs, Jev with Haiku votes as features: all 9 files

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 80.2 / 93.8 / 50.6 | 39.7 / 56.3 / **46.6** | 44.7 | 70.4 / 85.6 | 97.7 | 0.0 / 97.0 | 247 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 78.3 / 83.8 / 66.3 | 53.4 / 67.8 / **59.7** | 54.7 | 76.5 / 93.7 | 98.9 | 52.1 / 79.2 | 221 (68) |
| g: top-down, block question (range wording) (t=0.4) | 78.1 / 85.8 / 61.2 | 54.3 / 69.5 / **61.0** | 55.4 | 74.9 / 92.0 | 98.3 | 45.2 / 87.1 | 223 (54) |
| h: bottom-up, pair question (t=0.6) | 79.0 / 83.2 / 69.7 | 64.0 / 65.5 / **64.8** | 58.5 | 90.4 / 94.8 | 98.3 | 61.6 / 68.3 | 178 (98) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 80.6 / 85.1 / 70.8 | 61.7 / 75.9 / **68.0** | 61.9 | 80.4 / 96.6 | 98.3 | 63.0 / 85.1 | 214 (77) |
| g-cal: block question + calibrated regression (t=0.2) | 82.7 / 85.6 / 76.4 | 76.6 / 81.0 / **78.8** | 70.4 | 90.8 / 97.7 | 98.3 | 84.9 / 78.2 | 184 (87) |
| h-cal: pair question + calibrated regression (t=0.4) | 86.4 / 92.3 / 73.6 | 81.4 / 85.6 / **83.5** | 73.9 | 93.4 / 97.7 | 97.7 | 83.6 / 87.1 | 183 (73) |
| g2-cal: both, calibrated (t=0.2/0.4) | 83.0 / 85.3 / 78.1 | 78.1 / 82.2 / **80.1** | 71.7 | 90.7 / 97.7 | 98.3 | 89.0 / 77.2 | 183 (91) |

### References: structure only, and Haiku reading the whole file

"Structure only" has no model grouping: all instruction units inside one paragraph, list, table row or lead-in group are merged when the whole block is instructions, or when it is a list, a row or a lead-in group. With gold unit labels it is an upper bound for that idea.

Test files:

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| Structure only, gold unit labels (upper bound of "merge what sits in one paragraph/list/row") | 100.0 / 100.0 / 100.0 | 83.3 / 72.0 / **77.3** | 77.3 | 95.1 / 83.9 | 100.0 | 81.6 / 65.2 | 102 (51) |
| Structure only, Jev stacker labels | 77.7 / 91.7 / 43.4 | 56.3 / 49.2 / **52.5** | 46.2 | 87.4 / 78.8 | 95.8 | 38.8 / 56.5 | 103 (36) |
| Structure only, Haiku majority labels | 83.6 / 87.4 / 74.3 | 71.6 / 66.1 / **68.7** | 59.0 | 87.2 / 80.5 | 96.6 | 77.6 / 58.0 | 109 (57) |
| Haiku run 1 with its own groups | 80.1 / 82.7 / 73.5 | 71.9 / 82.2 / **76.7** | 64.8 | 85.9 / 96.6 | 96.6 | 85.7 / 79.7 | 135 (55) |
| Haiku run 2 with its own groups | 82.9 / 88.1 / 69.9 | 71.9 / 82.2 / **76.7** | 66.4 | 88.9 / 96.6 | 96.6 | 75.5 / 87.0 | 135 (44) |
| Haiku run 3 with its own groups | 85.4 / 88.5 / 77.9 | 76.9 / 84.7 / **80.6** | 71.0 | 89.2 / 96.6 | 96.6 | 87.8 / 82.6 | 130 (53) |
| Haiku consensus: spans 2 of 3 runs produced identically, else the majority unit label | 82.6 / 86.3 / 73.5 | 75.8 / 84.7 / **80.0** | 67.2 | 87.9 / 96.6 | 96.6 | 87.8 / 82.6 | 132 (52) |

All 9 files:

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| Structure only, gold unit labels (upper bound of "merge what sits in one paragraph/list/row") | 100.0 / 100.0 / 100.0 | 83.8 / 71.3 / **77.0** | 77.0 | 95.3 / 83.3 | 100.0 | 86.3 / 60.4 | 148 (79) |
| Structure only, Jev stacker labels | 75.6 / 91.0 / 42.1 | 59.1 / 52.3 / **55.5** | 48.2 | 85.1 / 77.6 | 95.4 | 52.1 / 52.5 | 154 (60) |
| Structure only, Haiku majority labels | 85.5 / 88.7 / 78.7 | 71.9 / 66.1 / **68.9** | 60.5 | 86.9 / 81.0 | 97.7 | 83.6 / 53.5 | 160 (87) |
| Haiku run 1 with its own groups | 83.0 / 84.8 / 79.2 | 72.0 / 82.8 / **77.0** | 67.9 | 85.5 / 96.6 | 97.7 | 84.9 / 81.2 | 200 (79) |
| Haiku run 2 with its own groups | 83.9 / 89.4 / 71.9 | 74.9 / 83.9 / **79.1** | 69.9 | 88.7 / 96.0 | 97.7 | 78.1 / 88.1 | 195 (66) |
| Haiku run 3 with its own groups | 86.6 / 89.4 / 80.3 | 76.9 / 86.2 / **81.3** | 73.7 | 88.7 / 97.7 | 97.7 | 86.3 / 86.1 | 195 (76) |
| Haiku consensus: spans 2 of 3 runs produced identically, else the majority unit label | 84.6 / 87.9 / 77.5 | 76.1 / 86.2 / **80.9** | 71.2 | 87.3 / 97.1 | 97.7 | 87.7 / 85.1 | 197 (75) |

### How far apart the designs really are (`an13.out.md`)

Exact-span F1 over all 9 files with a 95% interval from resampling the 9 files (thresholds fixed as chosen):

| Design | Exact-span F1 over all 9 files, % | 95% interval over files (bootstrap of the 9 files, 2000 draws) |
|---|---|---|
| Jev only: s0: per-unit labels only, no grouping | 47.0 | 37.0 to 58.6 |
| Jev only: g: top-down, block question (wording 1) | 58.2 | 50.3 to 65.1 |
| Jev only: g: top-down, block question (range wording) | 59.4 | 50.5 to 69.1 |
| Jev only: h: bottom-up, pair question | 62.0 | 52.0 to 70.8 |
| Jev only: g2: top-down then bottom-up merge | 65.6 | 55.0 to 73.8 |
| Jev only: g-cal: block question + calibrated regression | 72.2 | 64.1 to 79.2 |
| Jev only: h-cal: pair question + calibrated regression | 72.3 | 60.7 to 81.3 |
| Jev only: g2-cal: both, calibrated | 72.2 | 64.5 to 79.0 |
| Jev + Haiku features: s0: per-unit labels only, no grouping | 46.6 | 37.0 to 56.9 |
| Jev + Haiku features: g: top-down, block question (wording 1) | 59.7 | 52.2 to 67.3 |
| Jev + Haiku features: g: top-down, block question (range wording) | 61.0 | 51.3 to 70.0 |
| Jev + Haiku features: h: bottom-up, pair question | 64.8 | 53.0 to 73.8 |
| Jev + Haiku features: g2: top-down then bottom-up merge | 68.0 | 57.2 to 76.9 |
| Jev + Haiku features: g-cal: block question + calibrated regression | 78.8 | 69.9 to 86.4 |
| Jev + Haiku features: h-cal: pair question + calibrated regression | 83.5 | 75.8 to 90.8 |
| Jev + Haiku features: g2-cal: both, calibrated | 80.1 | 72.2 to 86.9 |
| Haiku run 1 with its own groups | 77.0 | 70.0 to 83.6 |
| Haiku run 2 with its own groups | 79.1 | 68.3 to 88.9 |
| Haiku run 3 with its own groups | 81.3 | 73.4 to 88.8 |

### Fewer labelled files for the calibration (dev-train, test files)

Calibration trained on the 3 dev files only (56 rules, about 40 linked pairs) instead of 8 files. The full tables are in `tables3.out.md`.

Jev only:

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 77.7 / 91.7 / 43.4 | 44.0 / 55.9 / **49.3** | 47.8 | 78.0 / 88.1 | 95.8 | 0.0 / 95.7 | 150 (0) |
| g-cal: block question + calibrated regression (t=0.3) | 76.5 / 77.0 / 75.2 | 70.1 / 75.4 / **72.7** | 66.9 | 85.0 / 94.1 | 97.5 | 75.5 / 75.4 | 127 (61) |
| h-cal: pair question + calibrated regression (t=0.3) | 80.3 / 85.3 / 68.1 | 67.0 / 61.9 / **64.3** | 58.1 | 90.8 / 89.8 | 95.8 | 65.3 / 59.4 | 109 (58) |
| g2-cal: both, calibrated (t=0.3/0.9) | 76.5 / 77.0 / 75.2 | 70.1 / 75.4 / **72.7** | 66.9 | 85.0 / 94.1 | 97.5 | 75.5 / 75.4 | 127 (61) |

Jev with Haiku features:

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 80.3 / 93.2 / 48.7 | 41.0 / 57.6 / **47.9** | 45.1 | 74.7 / 90.7 | 98.3 | 0.0 / 98.6 | 166 (0) |
| g-cal: block question + calibrated regression (t=0.3) | 79.5 / 82.0 / 73.5 | 71.3 / 82.2 / **76.4** | 67.7 | 86.0 / 99.2 | 99.2 | 77.6 / 85.5 | 136 (56) |
| h-cal: pair question + calibrated regression (t=0.8) | 85.7 / 92.4 / 69.0 | 73.3 / 83.9 / **78.3** | 68.8 | 91.1 / 98.3 | 98.3 | 71.4 / 92.8 | 135 (38) |
| g2-cal: both, calibrated (t=0.3/0.8) | 79.3 / 81.7 / 73.5 | 70.6 / 81.4 / **75.6** | 66.9 | 86.0 / 99.2 | 99.2 | 77.6 / 84.1 | 136 (57) |

### Which wording of the question works (`an8.out.txt`)

Area under the ROC curve for telling a candidate that is exactly one gold rule from the others (block questions, 30 positives of 73 candidates on dev, 55 of 167 on test), and for telling two neighbours that sit in one multi-unit rule from other pairs where at least one is an instruction (41 of 117 on dev, 64 of 239 on test). A wording was chosen on dev only; 0.5 is chance.

```
block wordings: AUC for "this candidate is exactly one gold rule" (positives dev/test)
one (phase 3 wording, 3 passes)      dev AUC 0.805 (30+/43-) | test AUC 0.804 (55+/112-)
one (phase 3 wording, pass 1)        dev AUC 0.809 (30+/43-) | test AUC 0.796 (55+/112-)
one2                                 dev AUC 0.662 (30+/43-) | test AUC 0.578 (55+/112-)
one3                                 dev AUC 0.718 (30+/43-) | test AUC 0.726 (55+/112-)
hasinstr                             dev AUC 0.784 (30+/43-) | test AUC 0.757 (55+/112-)
multi                                dev AUC 0.529 (30+/43-) | test AUC 0.544 (55+/112-)
allinstr                             dev AUC 0.595 (30+/43-) | test AUC 0.720 (55+/112-)
range                                dev AUC 0.826 (30+/43-) | test AUC 0.812 (55+/112-)
1 - multi                            dev AUC 0.471 (30+/43-) | test AUC 0.456 (55+/112-)
hasinstr*(1-multi)                   dev AUC 0.758 (30+/43-) | test AUC 0.711 (55+/112-)

pair wordings: AUC for "units a and a+1 are in the same multi-unit rule" over adjacent pairs where at least one is an instruction
same (phase 3, 3 passes)             dev AUC 0.900 (41+/76-) | test AUC 0.955 (64+/175-)
same (phase 3, pass 1)               dev AUC 0.897 (41+/76-) | test AUC 0.950 (64+/175-)
cont                                 dev AUC 0.781 (41+/76-) | test AUC 0.847 (64+/175-)
1 - newstart                         dev AUC 0.795 (41+/76-) | test AUC 0.743 (64+/175-)
needs (b needed for a)               dev AUC 0.714 (41+/76-) | test AUC 0.770 (64+/175-)
needsrev (a needed for b)            dev AUC 0.719 (41+/76-) | test AUC 0.708 (64+/175-)
max(needs, needsrev)                 dev AUC 0.734 (41+/76-) | test AUC 0.739 (64+/175-)
mean of 5 wordings                   dev AUC 0.861 (41+/76-) | test AUC 0.876 (64+/175-)
```

### Where the best Jev-only design finds and misses rules, and where two readers agree (`an10.out.md`)

Top-down arm (range wording, t=0.4): 83 of 240 blocks reach the threshold; 77 are accepted after overlaps; the multi-unit spans it accepts cover 122 of 566 units, which need no sentence-level question in a strictly sequential descent.

### Where the best Jev-only design (h-cal, t=0.5) finds and misses gold rules, test files

| Kind of gold rule | Rules | Found exactly | Share % |
|---|---|---|---|
| group | 4 | 2 | 50.0 |
| inside a block | 8 | 6 | 75.0 |
| paragraph | 24 | 19 | 79.2 |
| row | 13 | 11 | 84.6 |
| single unit | 69 | 59 | 85.5 |

### Two readers agree: accept a span only if the Jev design and the Haiku consensus produce it exactly

| Split | Gold rules | Spans accepted | Accepted spans that equal a gold rule (precision %) | Gold rules covered by an accepted span (recall %) | Of accepted multi-unit spans, precision % |
|---|---|---|---|---|---|
| dev | 56 | 36 | 83.3 | 53.6 | 90.9 (11) |
| test | 118 | 98 | 89.8 | 74.6 | 89.2 (37) |
| all | 174 | 134 | 88.1 | 67.8 | 89.6 (48) |

Per-unit labels, accepted only where both readers give the same label and the same span (or both see no instruction):

| Split | Units | Accepted | Accuracy on accepted % | Accuracy on all % |
|---|---|---|---|---|
| dev | 175 | 74 (42.3%) | 93.2 | 78.3 |
| test | 391 | 203 (51.9%) | 88.2 | 84.7 |
| all | 566 | 277 (48.9%) | 89.5 | 82.7 |

### Gold rules the best Jev-only design does not find exactly, test files

Predicted spans not in gold: 24; gold rules not predicted exactly: 21.

Gold rules not predicted exactly:

- tool-loans-skill.md units 25-28 [rule]: "Tell the member to bring three things to the desk on the day" -> predicted as 3 unit(s)
- rota-writer-helper.md units 8-8 [prohibition]: "Anything the caller does not tell you is unknown, and unknow" -> predicted as nothing
- rota-writer-helper.md units 32-33 [gate]: "The sign-up list has fewer names than posts." -> predicted as 1 unit(s)
- rota-writer-helper.md units 38-39 [prohibition]: "Two volunteers ask to swap places." -> predicted as 1 unit(s)
- rota-writer-helper.md units 52-52 [rule]: "Use the nickname on the rota and the full name on the first " -> predicted as 2 unit(s)
- parts-and-donations-notes.md units 9-10 [rule]: "A visitor asks for a part we may have." -> predicted as 1 unit(s)
- parts-and-donations-notes.md units 24-25 [prohibition]: "A donor asks for a receipt for tax." -> predicted as 1 unit(s)
- parts-and-donations-notes.md units 36-36 [gate]: "Read the row for the right date before you say a table is fr" -> predicted as 2 unit(s)
- parts-and-donations-notes.md units 55-55 [rule]: "Remember that the porch is dark by four in December." -> predicted as nothing
- booking-tool-reference.md units 30-30 [rule]: "A date in another form returns an empty list and not an erro" -> predicted as nothing
- booking-tool-reference.md units 75-76 [rule]: "You tried to write." -> predicted as 1 unit(s)
- session-lead-handbook.md units 12-15 [gate]: "Before you post the day's queue, check three things:" -> predicted as 2 unit(s)
- session-lead-handbook.md units 19-20 [prohibition]: "Never let a booked visitor wait behind the queue." -> predicted as 1 unit(s)
- session-lead-handbook.md units 21-21 [rule]: "If the queue is longer than ten names, tell new arrivals the" -> predicted as 2 unit(s)
- session-lead-handbook.md units 22-22 [rule]: "Say it in minutes and round up to the next quarter hour." -> predicted as 2 unit(s)
- visitor-replies-guide.md units 6-7 [rule]: "Answer with what the café usually does, not with a promise." -> predicted as 1 unit(s)
- visitor-replies-guide.md units 26-27 [rule]: "Mended" -> predicted as nothing
- visitor-replies-guide.md units 28-29 [rule]: "Needs a part" -> predicted as nothing
- visitor-replies-guide.md units 40-40 [rule]: "Say this once, kindly, when a visitor books the collection." -> predicted as 2 unit(s)
- visitor-replies-guide.md units 61-61 [prohibition]: "Do not use the word unfortunately in the first line of a mes" -> predicted as 2 unit(s)
- visitor-replies-guide.md units 62-62 [rule]: "Open with what can be done." -> predicted as 2 unit(s)

### Cost (`an10.out.md`)

Calls per pass are what a fresh run needs; the table counts each recorded request once, so it can differ from the number of network calls in the spend section (cached requests are reused when a window did not change).

| Question set | Passes | Calls (all passes) | Calls per pass | Tokens in / out per pass (k) |
|---|---|---|---|---|
| unit label questions, arm a (rules + examples) | 3 | 93 | 31 | 438 / 61 |
| unit sub-questions, arm b | 3 | 84 | 28 | 218 / 72 |
| unit label questions, arm 0 wording | 3 | 63 | 21 | 147 / 61 |
| unit label questions, arm c paraphrase 1 | 3 | 63 | 21 | 147 / 71 |
| arm c paraphrase 2 | 3 | 63 | 21 | 180 / 71 |
| arm c paraphrase 3 | 3 | 63 | 21 | 145 / 71 |
| arm d, no heading lines | 3 | 63 | 21 | 146 / 61 |
| arm d, heading lines + file role | 3 | 63 | 21 | 147 / 61 |
| block questions (one, forbid, order), 240 blocks | 3 | 75 | 25 | 69 / 15 |
| six other wordings of the block question | 3 | 75 | 25 | 112 / 31 |
| pair question, 541 neighbour pairs | 3 | 75 | 25 | 72 / 11 |
| h-var | 1 | 25 | 25 | 118 / 46 |
| **Total, phase 3** | | **805** | | 5.58M in / 1.80M out |

## What the numbers say

- **Grouping is worth 25 to 37 points of exact-span F1.** Over all 9 files, s0 (no grouping) scores 47.0% (Jev only) and 46.6% (with Haiku features); the calibrated designs score 72.2% to 72.3% and 78.8% to 83.5%. The intervals over files (`an13.out.md`) separate s0 (37% to 59%) from the calibrated designs (61% to 91%).
- **Without calibration, the local question is better than the block question, and using both is best.** Pair question (h) 62.0%, block question (g) 58.2% to 59.4%, both (g2) 65.6% (Jev only, all files). The pair question separates linked from unlinked neighbours well (AUC 0.90 dev, 0.955 test); the block question does not (AUC 0.80 to 0.83 for the two best wordings, 0.46 to 0.78 for the others). Asking a large block "is this one instruction?" mixes two questions in one: does it hold an instruction, and is it only one.
- **With calibration the three designs end up in the same place.** Jev only: 72.2%, 72.3%, 72.2%; with Haiku features 78.8%, 83.5%, 80.1%. The intervals overlap; I do not claim a winner between top-down and bottom-up. On the 3 dev files the order is the opposite of the 6 test files for Jev only (h-cal 54.2% on dev, 81.2% on test), which is what 56 rules of dev data do.
- **Top-down pays for itself in questions, not in accuracy.** Blocks accepted by the range wording at t=0.4 cover 122 of 566 units, which a strictly sequential descent would not ask about at sentence level (`an10.out.md`).
- **Calibration needs labelled files from the same estate, most for the pair design.** With only the 3 dev files for training, the calibrated pair design falls from 81.2% to 64.3% on the test files (Jev only) and from 82.1% to 78.3% (with Haiku features); the calibrated block design does not change (72.1% to 72.7%, and 75.6% to 76.4%).
- **A second reader helps spans more than it helped units.** Adding Haiku votes lifts calibrated exact-span F1 over all files from 72.3% to 83.5% for the pair design. Haiku alone, reading each file with the guide, scores 77.0%, 79.1%, 81.3% in its three runs and 80.0% in consensus on the test files.
- **Per-unit accuracy and span accuracy move together but differ.** For the pair design (Jev only, all files) per-unit accuracy is 82.7% (89.4% outside, 68.0% inside multi-unit rules), exact-span F1 72.3%, IoU >= 0.5 recall 92.5%, any-overlap recall 95.4%. The edges of a span are harder than its presence: kind adds another 6 to 10 points of error (exact + kind F1 66.1% against 72.3% here).
- **Single-unit rules are found exactly 77% to 87% of the time, multi-unit rules 67% to 89%** (all files, the six calibrated rows), and the misses are mostly neighbours: two single rules fused, or a rule and its exception split (`an10.out.md`, wrong spans).
- **No design is near 99%, and the gold does not allow a 99% claim.** Two readers agreeing exactly on a span produce 89.8% precision on the test files and cover 74.6% of the gold rules (88.1% and 67.8% over all files). Accepted per-unit labels (both readers give the same label and the same span) are right 88.2% of the time on test, for 51.9% of the units. A fresh Haiku annotator reaches 81.8% exact-span F1 against the frozen gold, and the exact-span F1 of A against B is 76.1%.

## What design this points to

- **Keep the tree and the ids.** Sections, paragraphs, lists, tables, rows and lead-in groups each get an id, and a rule is a list of unit ids with a kind (86% of the multi-unit rules also equal one node, and carry its id when they do).
- **Ask local questions, merge in code.** One class question set per unit and one "same instruction as the neighbour?" question per pair of neighbours, inside a window that shows the structure. Do not rely on a single "is this block one instruction?" question.
- **Put structure into a small calibrated model, not into rules.** Same paragraph, same row, lead-in group, container kind and the unit class vectors are features next to the Jev probabilities. Structure alone, with perfect unit labels, already gives 77.3% on the test files, so the regression should learn that prior and let Jev decide the exceptions.
- **Plan labelled files of the same estate for the calibration.** Trained on 56 rules, the pair design lost 4 to 17 points of exact-span F1 on the test files against training on the other 8 files; the block design lost none. How many labelled rules are enough was not measured.
- **Use a second reader for spans.** Haiku votes on class and on grouping add 7 to 11 points over Jev alone (72.2% to 78.8%, 72.3% to 83.5%, 72.2% to 80.1% for the block, pair and combined designs, all files).
- **Report two numbers per reader: where the rules are and what exact edges they have.** Presence (any-overlap recall 95%+) is close to solved; exact edges are 72% to 84%, and that is the level two careful annotators also reach.

## Limits

- One estate type, fictional, written by one author; its two annotators reach an exact-span F1 of 76.1% against each other before adjudication.
- Spans are consecutive units only. A rule that skips a unit, or that spans two sections, is not represented. Lists inside lists are one list.
- The thresholds and the features were tuned on 56 rules (dev). Test-file numbers are not blind (see above); the file-bootstrap intervals are wide (about +/- 8 to 10 points).
- The unit stacker was trained on a different corpus and the Haiku features come from different guides in the two phases.
- Jev answers are not deterministic; the cassette fixes them. Wordings were chosen on dev; one pair wording and the six block wordings were tried once (3 passes for the block wordings).

## Spend

- Jev: **818 calls** attempted (816 answered, 2 failed attempts of one request with an empty question set, fixed before the rerun), 5,602,324 input and 1,808,304 output tokens (`spend3-jev.json`). USD unknown: no price on file.
- Haiku `claude-haiku-5-5`: **27 calls** (3 runs x 9 files), 75,432 input and 118,602 output tokens (`spend3-haiku.json`). No price on file; at assumed rates of 1 to 5 USD per million input tokens and 5 to 25 USD per million output tokens the phase is between 0.7 and 3.3 USD. Phase 2 plus phase 3 together (173,190 input and 185,352 output tokens) would be between 1.1 and 5.5 USD at those assumed rates, so the top of the range passes the 5 USD cap if the cap covers both phases; the real price decides.
- Keys: read from `~/.nexus-secrets`, never printed; both cassettes hold no key, header or `Authorization` text (checked for the key text and its first 12 characters).
- Replay: `JEV_MODE=replay ./run3.sh <spec>` and `JEV_MODE=replay pnpm exec tsx jev-experiments/run3h.ts <run>` rebuild a result file from the cassettes with no network and no key. After replaying 4 Jev runs and 2 Haiku runs, `an9.ts` printed tables identical to the recorded ones.

## Files

`GUIDE3.md` (labelling guide with the span rule) · `prose3-src/` (sources with tags), `prose3/` · `annot3-b.tsv`, `agree3.ts`, `agree3.out.txt`, `disagreements3.tsv`, `span-disagreements3.txt` · `freeze3.ts`, `gold3.json`, `gold3.sha256`, `gold3.author.json` · `src/tree.ts` (nested units and ids), `export-spans.ts`, `nodes3.json`, `spans3.json` · `src/p3.ts` (windows, block and pair questions), `src/lib3.ts`, `src/cal3.ts`, `src/designs3.ts`, `src/spans.ts` · `run3.ts`, `run3.sh`, `run3h.ts`, `sheet3.ts` · `an8.ts`, `an9.ts`, `an10.ts`, `an11.ts`, `an12.ts`, `an13.ts` and their `.out` files, `tables3.out.md` · `results3/`, `cassette3.jsonl.gz`, `cassette3-haiku.jsonl.gz`, `spend3-*.json`.
