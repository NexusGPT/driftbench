# Blocks validator: where the gate stands

Status, 2026-10-17: a proposal for the owner. This file sets no bar yet: it holds no line that `--hardness` reads. The section 12 bar stands until the owner decides.

The blocks bank was extended twice under the rule "extend the bank, never lower the bar" (section 12.4 point 5). The extensions added the evidence names, one cause each, and the blind breaker's items, and they made the cause count honest. The blind pilot that followed still forecasts about 31 iterations, against the 100 the bar asks for. No item was added to reach the bar.

## The numbers

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

## The rounds

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

## Why the bar is out of reach with honest items

Two foundations, the parent forest and blocked propagation, gave 200 of the 266 fixes in two iterations. The honest cause count already merges the causes they close, but a cause cannot be split below the one change it needs. The items that still fail sit on a few more such foundations: the object resolver, the value ladder, the blame steps, personas and parent export. A blind fixer lands each in one or two iterations, as the pilot did with the forest. The small, independent causes, such as one evidence name, one refusal or one scale fix, move a few items each, but they are a minority of the failing items.

The arithmetic of the section 12 bar on this bank:

- A forecast of 100 at 26.8 items per iteration needs 2,680 items still failing after the pilot, against 825. That is about 1,855 more items that fail on main and each need their own change. The docs do not hold that many independent documented rules; they would have to be invented, which the bar forbids.
- A score of 0.4 after the pilot, with 1,381 items passing, needs a bank of 3,453 items. That is 1,247 more, all failing after ten rounds of a blind fixer.

## Proposed bar, for the owner to decide

| Term | Section 12 | Proposed | Measured |
|---|---|---|---|
| Max score after the pilot | 0.4 | 0.65 | 0.626 |
| Min forecast | 100 | 30 | 30.78 |
| Min distinct failing causes | 100 | 100 (kept) | 162 |

The owner's fallback, 2026-10-12, as the statistics validator records it in its GATE.md: "If you cannot do it, lower the bar per validator". If the owner accepts, this file gets the three lines `--hardness` reads, and the audit (section 12.7) still applies.

## What the validator found in the product

Real defects of main the bank turns red. Each changes a verdict or a number a user reads:

1. The safety check missed `git checkout -- <path>` as an overwrite. Fixed in trial round 8.
2. The personal-data scan took 7 s on 80,000 characters with no address in them. Fixed in trial round 9.
3. The runner grows faster than linearly in its blocks in modes F and T (5.3 s at 2,500 blocks, against a 2.4 s budget). Rounds 7 and 10 of trial4 did not fix it.
4. A regex inside a `regex` list, a JSON path assertion or a perturbation's `expect` was not checked (`REGEX_INVALID`). Fixed in trial round 7.
