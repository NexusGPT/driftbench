# Blocks validator: where the gate stands

Status, 2026-10-18: the gate is not met. The fresh blind pilot on the grown bank (trial5) meets the forecast and the distinct causes of section 12, and misses the score. The lead ruled that the lower bar stands only if this pilot still misses section 12. It misses on the score alone, so only the score line of the lower bar is kept, and it is still not met. The forecast line is dropped: the bar of section 12 (100) holds. The gate also waits for `audit.md` (section 12.7).

## The numbers (trial5)

From `driftbench validate blocks --hardness`, journal `validators/blocks/journal.jsonl`. Iteration 0 and ten blind rows on `train/blocks-trial5`, each round measured in CI on seeds 1 to 3 and the hidden seed. Trial4's rows are in `journal-trial4.jsonl`, trial3's in `journal-trial3.jsonl`.

| Measure | Value | Gate (docs/validators.md section 12) |
|---|---|---|
| Bank | 3,159 items, 95 families, tiers 1 to 5 | 300 items, no family under 20, every tier: holds |
| Score at iteration 0 | 0.754 (2,382 of 3,159) | |
| Score after the pilot | 0.7629 (2,410 of 3,159) | at most 0.4: not met; at most 0.65 (the line below): not met |
| Items fixed per iteration | 2.8 | |
| Forecast | 267.5 iterations (749 failing / 2.8) | at least 100: met |
| Distinct failing causes | 155 (167 at iteration 0, 1.2 fewer per round: 129 rounds by causes) | at least 100: met |
| Level | 0 in every round | |
| Audit | `audit.md` absent for this bank | required |

The score is high because the growth items test documented behaviours main mostly already has: 927 of the 953 new items pass on main. They are honest items, and they make the bank harder to overfit, but each one that passes raises the score.

## The rounds (trial5)

| Round | Fix | Commit | Failing after | Causes after |
|---|---|---|---|---|
| 0 | baseline | | 777 | 167 |
| 1 | the event log is exported from the core package | 69220e68d | 770 | 165 |
| 2 | a json path that reads nothing fails every assertion but absent | aab22d31e | 766 | 164 |
| 3 | finish_reason inconclusive for want of a reason no longer gates | 1eb25445c | 762 | 163 |
| 4 | exact reads true and false as 1 and 0 | 043128459 | 761 | 162 |
| 5 | the personal-data email scan starts only at an address run | af8f458eb | 759 | 161 |
| 6 | a repeated guard or helper entry is named `#2` after its name | d58bb5483 | 757 | 160 |
| 7 | `REGEX_INVALID` for the regex list, json path and perturbation patterns | c2a408b20 | 754 | 157 |
| 8 | the spec version label is no part of the spec hash | 83e4dbaaa, a674e2cfa | 750 | 156 |
| 9 | markup sql fails a cut-off statement and an unrecognised token | dd55d3f90 | 749 | 155 |
| 10 | `git checkout -- <path>` counts as an overwrite | 968d22251 | 749 | 155 |

Round 10 fixed `bk.limits.safety.command-overwrite-forms` and lost `gr.checks.scores.bleu.seeded-pairs` on the hidden seed. That was a defect of the item: it dropped the pairs whose BLEU is 0, and on 21 of 212 item seeds every random pair scored 0, so the spec had no blocks. The item now draws more pairs until four score above 0 (0 of the same 212 seeds fail). Without that loss the forecast is 257.9.

Still failing at level 1 after the pilot: `bg.stage.flow.no-flow-verdict.reported-in-a-block-that-expects-none`, `gr.checks.data.email-include.include-flags-localhost`, `scale/run-F/100x`, `scale/run-T/100x`.

## The recorded bar

Max score after the pilot: 0.65

The forecast and the distinct failing causes keep the bar of section 12: at least 100 each.

| Term | Section 12 | Blocks bar | Measured after trial5 |
|---|---|---|---|
| Max score after the pilot | 0.4 | 0.65 | 0.7629 |
| Min forecast | 100 | 100 | 267.5 |
| Min distinct failing causes | 100 | 100 | 155 |

The 0.65 line was set after trial4, from that pilot's numbers. Whether it changes after trial5 is the lead's ruling; this file does not lower it further.

## The audit

| Check | Status |
|---|---|
| blind pilot | done: trial5, ten rows in the journal (forecast 267.5) |
| cheater | held by the lead until growth and the pilot are done; to run on this bank |
| cause review | to run on this bank (sample to be redrawn from the grown bank) |
| planted bugs | to run on this bank |

## History: the trial4 pilot (2026-10-17)

Status, 2026-10-18: provisional. The lead ruled that the bank grows first, from documented behaviours no item tested, and that a fresh blind pilot on the grown bank decides whether the lower bar below stands. Until that pilot ends, the bar below is provisional. As first set on 2026-10-17, the blocks validator has a bar of its own, lower than the bar of section 12. The lead set it under the owner's rule, after the blind pilot, from the pilot's measured numbers: a score after the pilot of 0.626, a forecast of 30.78 iterations and 162 distinct failing causes. The reason is the arithmetic below: a forecast of 100 would need about 1,855 more independent failing items. The gate still does not hold until `audit.md` records the four audit checks (section 12.7).

The blocks bank was extended twice under the rule "extend the bank, never lower the bar" (section 12.4 point 5). The extensions added the evidence names, one cause each, and the blind breaker's items, and they made the cause count honest. The blind pilot that followed still forecasts about 31 iterations, against the 100 the bar asks for. No item was added to reach the bar.

### The numbers

From `driftbench validate blocks --hardness`, journal `validators/blocks/journal.jsonl`. Iteration 0 and ten blind rows on `train/blocks-trial4`, each round measured in CI on seeds 1 to 3 and the hidden seed.

| Measure | Value | Gate (docs/validators.md section 12) |
|---|---|---|
| Bank | 2,206 items, 75 families, tiers 1 to 5 | 300 items, no family under 20, every tier: holds |
| Score at iteration 0 | 0.5106 (1,113 of 2,180) | |
| Score after the pilot | 0.626 (1,381 of 2,206) | at most 0.4: not met |
| Items fixed per iteration | 26.8 | |
| Forecast | 30.78 iterations (825 failing / 26.8) | at least 100: not met |
| Distinct failing causes | 162 | at least 100: met |
| Audit | `audit.md` absent for this bank | required |

The same pilot with the catch items left out (PR 741, under review), with the breaker items that pass on main counted as catch items too:

| Measure | Value |
|---|---|
| Hardness items | 1,816 |
| Score after the pilot | 0.5529 (1,004 of 1,816) |
| Failing items | 812 |
| Forecast at 26.8 per iteration | about 30 |
| Distinct failing causes | 149 |

### The rounds

| Round | Fix | Items fixed |
|---|---|---|
| 1 | `workspace.binary` loads as base64 | 8 |
| 2 | the seed writes the bytes, a byte-order mark kept | 14 |
| 3 | `WORKSPACE_PATH_TWICE` | 6 |
| 4 | parent links in the loader | 32 |
| 5 | the parent forest | 94 |
| 6 | blocked propagation | 106 |
| 7 | `REGEX_INVALID` in four more places | 4 |
| 8 | `git checkout -- <path>` counts as an overwrite | 1 |
| 9 | the personal-data scan is linear on a reply with no address | 1 |
| 10 | a frozen history (no item turned green) | 0 |

Two items broke on the hidden seed, in rounds 2 and 4. Both were defects of the items, and the maintainer fixed each in its own commit (675dc27d3, 07a643b29). The bank was refreshed before round 8 to the breaker's final items (merge 96f71f19a).

### Why the bar is out of reach with honest items

Two foundations, the parent forest and blocked propagation, gave 200 of the 266 fixes in two iterations. The honest cause count already merges the causes they close, but a cause cannot be split below the one change it needs. The items that still fail sit on a few more such foundations: the object resolver, the value ladder, the blame steps, personas and parent export. A blind fixer lands each in one or two iterations, as the pilot did with the forest. The small, independent causes, such as one evidence name, one refusal or one scale fix, move a few items each, but they are a minority of the failing items.

The arithmetic of the section 12 bar on this bank:

- A forecast of 100 at 26.8 items per iteration needs 2,680 items still failing after the pilot, against 825. That is about 1,855 more items that fail on main and each need their own change. The docs do not hold that many independent documented rules; they would have to be invented, which the bar forbids.
- A score of 0.4 after the pilot, with 1,381 items passing, needs a bank of 3,453 items. That is 1,247 more, all failing after ten rounds of a blind fixer.

### The recorded bar

The bar recorded then: a max score after the pilot of 0.65 and a min forecast of 30.

The distinct failing causes keep the bar of section 12: at least 100.

| Term | Section 12 | Blocks bar | Measured after the pilot |
|---|---|---|---|
| Max score after the pilot | 0.4 | 0.65 | 0.626 |
| Min forecast | 100 | 30 | 30.78 |
| Min distinct failing causes | 100 | 100 | 162 |

This bar is lower than the bar of section 12. It was set after the pilot, from the pilot's own numbers, and not before it. The owner's rule, 2026-10-12, as the statistics validator records it in its GATE.md: "If you cannot do it, lower the bar per validator". `driftbench validate blocks --hardness` reads the two lines above (`parseGate`, which takes a value only when it lowers a term of section 12.4).

### The audit

The gate holds only when `audit.md` gives a `pass` for each of the four checks of section 12.7, each run by an independent lane:

| Check | Status |
|---|---|
| blind pilot | done: trial4, ten rows in the journal (forecast 30.78) |
| cheater | to run on this bank |
| cause review | to run on this bank |
| planted bugs | to run on this bank |

### What the validator found in the product

Real defects of main the bank turns red. Each changes a verdict or a number a user reads:

1. The safety check missed `git checkout -- <path>` as an overwrite. Fixed in trial round 8.
2. The personal-data scan took 7 s on 80,000 characters with no address in them. Fixed in trial round 9.
3. The runner grows faster than linearly in its blocks in modes F and T (5.3 s at 2,500 blocks, against a 2.4 s budget). Rounds 7 and 10 of trial4 did not fix it.
4. A regex inside a `regex` list, a JSON path assertion or a perturbation's `expect` was not checked (`REGEX_INVALID`). Fixed in trial round 7.
