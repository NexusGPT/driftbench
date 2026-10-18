# Blocks validator: where the gate stands

Status, 2026-10-18: the bar below holds on the numbers of trial6, the blind pilot on the bank grown to 3,308 items; the gate still waits for `audit.md` (section 12.7). The blocks validator has a bar of its own on one term, the score. The lead set it on 2026-10-18 under the owner's rule of 2026-10-12, "If you cannot do it, lower the bar per validator". The forecast and the distinct causes keep the bar of section 12 and meet it.

Why the score bar is lowered. The bank grew from documented behaviours no item tested, and those items mostly test what main already does: 927 of the 953 growth items pass on main. They are honest items, and each one that passes raises the score. A score of 0.4 with 2,410 items passing needs a bank of at least 6,025 items, about 2,866 more items that main fails. Two inventories of every documented rule main lacks (main's docs, `docs/reference/block-contracts.md` and the docs of the open pull requests) found 244 missing rules in 108 distinct causes, and about 283 cases no bank item tests yet. Adding them all leaves the score near 0.65; more items would be re-seeded copies of one case, which the bar forbids.

## The numbers (trial6)

From `driftbench validate blocks --hardness`, journal `validators/blocks/journal.jsonl`. Iteration 0 and ten blind rows on `train/blocks-trial6`: origin/main 015bd6f34 merged with the bank 6e219f4c9 (commit 57a73134c), each round measured in CI on seeds 1 to 3 and the hidden seed. Trial5's rows are in `journal-trial5.jsonl`, trial4's in `journal-trial4.jsonl`, trial3's in `journal-trial3.jsonl`.

| Measure | Value | Gate (docs/validators.md section 12) |
|---|---|---|
| Bank | 3,308 items, 101 families, tiers 1 to 5 | 300 items, no family under 20, every tier: holds |
| Score at iteration 0 | 0.7427 (2,457 of 3,308) | |
| Score after the pilot | 0.7524 (2,489 of 3,308) | at most 0.4: not met; at most 0.8 (the blocks bar): met |
| Items fixed per iteration | 3.2 | |
| Forecast | 255.9 iterations (819 failing / 3.2) | at least 100: met |
| Distinct failing causes | 200 (211 at iteration 0, 1.1 fewer per round: 182 rounds by causes) | at least 100: met |
| Level | 0 in every round | |
| Audit | `audit.md` absent for this bank | required |

The bank grew by 149 items before this pilot: 77 for rules main's own docs state and main does not meet (`blocks-growth/docgaps`), and 72 for cases of `docs/reference/block-contracts.md` no item tested (`blocks-growth/contracts2`). They come from two inventories of every documented rule main lacks: 244 rules in 108 causes, about 283 cases not yet in the bank, of which these items take the testable ones.

After trial6 the bank took 44 link items (`blocks-links2`, families links2-localize and links2-schema, merged from `fix/validators-blocks-links` at 41955e719): 8 fail on main on one cause the bank already holds (a stale link still counts in `radius localize`). The bank is now 3,352 items, 103 families and 826 causes. The journal still measures the 3,308 items of the pilot; the 44 items are not in its rows. Ladder version 2 is kept, as for every growth since trial3.

## The rounds (trial6)

Every round fixed what its commit claimed and broke nothing. Iteration 4 and iteration 8 reached CI between two polls of the dispatch loop, so each was measured on a ref of its own (`train/blocks-trial6-i4`, `train/blocks-trial6-715310048`).

| Round | Fix | Commit | Fixed | Failing after | Causes after |
|---|---|---|---|---|---|
| 0 | baseline | 57a73134c | | 851 | 211 |
| 1 | flow.order is added only when the stage came from the classifier, never for a stage the runtime reports or carries Measured: 6 items fixed, 0 broken, 845 failing after. | 8fc709772 | 6 | 845 | 209 |
| 2 | the sql check and markup sql read statements as SQLite does, so comments, strings and a doubled final semicolon no longer change the statement count or the ORDER BY Measured: 4 items fixed, 0 broken, 841 failing after. | eb1a61dc8 | 4 | 841 | 208 |
| 3 | an sql verdict the golden query or its database cannot decide is inconclusive and does not gate Measured: 3 items fixed, 0 broken, 838 failing after. | b44312faf | 3 | 838 | 207 |
| 4 | a custom check name may start with a dot, an underscore or a hyphen Measured: 3 items fixed, 0 broken, 835 failing after. | cef8c557f | 3 | 835 | 206 |
| 5 | must and must_not ignore one trailing punctuation mark of any kind, and the space after it, when match_case is false Measured: 4 items fixed, 0 broken, 831 failing after. | 1fea9496b | 4 | 831 | 205 |
| 6 | schema_strict compiles a schema pattern as a JavaScript regular expression without the unicode flag Measured: 2 items fixed, 0 broken, 829 failing after. | 1f8a4ca86 | 2 | 829 | 204 |
| 7 | a function-style tool schema, flat or nested under function, is read by its parameters Measured: 2 items fixed, 0 broken, 827 failing after. | ce21f3950 | 2 | 827 | 203 |
| 8 | the spec version label stays out of the spec hash, so it no longer moves a cell id Measured: 4 items fixed, 0 broken, 823 failing after. | 715310048 | 4 | 823 | 202 |
| 9 | a failing budget cost_usd or latency_ms names how far over its limit the block went, a limit of 0 included Measured: 2 items fixed, 0 broken, 821 failing after. | 1ff5faca9 | 2 | 821 | 201 |
| 10 | rules.one_message_per_turn counts a card beside a text segment as a message of its own; also refreshes two test expectations that depended on cell ids and on flow.order (run ids in the scorecard snapshot, the audited cell in two campaign tests) Measured: 2 items fixed, 0 broken, 819 failing after. | d653339be | 2 | 819 | 200 |

## The bar

Max score after the pilot: 0.8

The forecast and the distinct failing causes keep the bar of section 12: at least 100 each.

| Term | Section 12 | Blocks bar | Measured after trial6 |
|---|---|---|---|
| Max score after the pilot | 0.4 | 0.8 | 0.7524: met |
| Min forecast | 100 | 100 | 255.9: met |
| Min distinct failing causes | 100 | 100 | 200: met |

`driftbench validate blocks --hardness` reads the line above (`parseGate`, which takes a value only when it lowers a term of section 12.4). The bank keeps growing with the honest missing cases; the next blind pilot is reported against this bar.

## The audit

| Check | Status |
|---|---|
| blind pilot | done: trial6, ten rows in the journal (forecast 255.9) |
| cheater | the lead's go of 2026-10-18; to run on this bank, from 57a73134c |
| cause review | running: 30 items of 30 families drawn from the trial6 baseline run 39148422418 |
| planted bugs | the lead's go of 2026-10-18; to run on this bank, from 57a73134c |

## History: the trial5 pilot (2026-10-18)

### The numbers

From `driftbench validate blocks --hardness`, journal `validators/blocks/journal-trial5.jsonl` (then `journal.jsonl`). Iteration 0 and ten blind rows on `train/blocks-trial5`, each round measured in CI on seeds 1 to 3 and the hidden seed. Trial4's rows are in `journal-trial4.jsonl`, trial3's in `journal-trial3.jsonl`.

| Measure | Value | Gate (docs/validators.md section 12) |
|---|---|---|
| Bank | 3,159 items, 95 families, tiers 1 to 5 | 300 items, no family under 20, every tier: holds |
| Score at iteration 0 | 0.754 (2,382 of 3,159) | |
| Score after the pilot | 0.7629 (2,410 of 3,159) | at most 0.4: not met; at most 0.8 (the blocks bar): met |
| Items fixed per iteration | 2.8 | |
| Forecast | 267.5 iterations (749 failing / 2.8) | at least 100: met |
| Distinct failing causes | 155 (167 at iteration 0, 1.2 fewer per round: 129 rounds by causes) | at least 100: met |
| Level | 0 in every round | |
| Audit | `audit.md` absent for this bank | required |

The score is high because the growth items test documented behaviours main mostly already has: 927 of the 953 new items pass on main. They are honest items, and they make the bank harder to overfit, but each one that passes raises the score.

### The rounds

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
