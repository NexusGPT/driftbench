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

{{AGREE}}

- Per-unit label agreement 80.0% (kappa 0.748). Instruction against not-instruction: 90.8%. Rules: A 173 (69 multi-unit), B 200 (79 multi-unit). Exact-span F1 of B against A: 76.1%; on multi-unit rules only 79.7%; IoU >= 0.5 recall 97.7%. The annotators agree on where a rule is far more often than on its exact edges and kind.
- **Adjudication** (`freeze3.ts`, every decision listed in the script): B's label stands on 5 units, my label stands on all other differences; 3 of my groups were dropped and 7 of B's groups added; the kind of 19 groups was decided against the guide and 2 units were set to description. 129 units and 47 rules are marked `contested`. The frozen gold agrees with A on 521 of 566 units and with B on 493. sha256 `dece89d68125e302f5c16ff9714b4be11a48b751fa04dd4bcc1939268932a7f8` (`gold3.sha256`), committed in `65f9255e4` before the first Jev call of this phase.
- Annotators against the frozen gold (`an11.out.txt`). A wrote the gold, so its row is not a fair ceiling; B's row is:

{{ANNOT}}

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

{{PERUNIT}}

Per-unit labelling is good where a unit is an instruction by itself (91.7% outside multi-unit rules with the transferred stacker) and weak inside multi-unit rules (43.4%): a lead-in sentence, a table cell or an "if X" sentence is not an instruction on its own.

### Span designs, Jev only: test files (6 files, 118 rules)

{{J_TEST}}

### Span designs, Jev only: all 9 files (174 rules)

{{J_ALL}}

### Span designs, Jev with Haiku votes as features: test files

{{JH_TEST}}

### Span designs, Jev with Haiku votes as features: all 9 files

{{JH_ALL}}

### References: structure only, and Haiku reading the whole file

"Structure only" has no model grouping: all instruction units inside one paragraph, list, table row or lead-in group are merged when the whole block is instructions, or when it is a list, a row or a lead-in group. With gold unit labels it is an upper bound for that idea.

Test files:

{{REF_TEST}}

All 9 files:

{{REF_ALL}}

### How far apart the designs really are (`an13.out.md`)

Exact-span F1 over all 9 files with a 95% interval from resampling the 9 files (thresholds fixed as chosen):

{{BOOT}}

### Fewer labelled files for the calibration (dev-train, test files)

Calibration trained on the 3 dev files only (56 rules, about 40 linked pairs) instead of 8 files. The full tables are in `tables3.out.md`.

Jev only:

{{JD_TEST}}

Jev with Haiku features:

{{JHD_TEST}}

### Which wording of the question works (`an8.out.txt`)

Area under the ROC curve for telling a candidate that is exactly one gold rule from the others (block questions, 30 positives of 73 candidates on dev, 55 of 167 on test), and for telling two neighbours that sit in one multi-unit rule from other pairs where at least one is an instruction (41 of 117 on dev, 64 of 239 on test). A wording was chosen on dev only; 0.5 is chance.

{{AUC}}

### Where the best Jev-only design finds and misses rules, and where two readers agree (`an10.out.md`)

{{REST}}

### Cost (`an10.out.md`)

Calls per pass are what a fresh run needs; the table counts each recorded request once, so it can differ from the number of network calls in the spend section (cached requests are reused when a window did not change).

{{COST}}

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
