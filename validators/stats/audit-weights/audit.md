# Audit of the weights family of the statistics bank (docs/validators.md section 12.7), ladder version 4

The family is `packages/validators/src/ladders/stats/bank/weights/`: 146 items in four families (weights-agreement 42, weights-wilson 30, weights-mixture 44, weights-coverage 30), all at the `analytic` level. Round 2 below audits version 4. Round 1 (version 3 era, the family at its first form) is kept at the end as history.

## Round 2: version 4 (pending)

Verdicts are written by the audit helpers only, never by the builder. Each seat is a fresh Sonnet helper at medium effort that has not read the family's `index.ts` items or the builder's handoff (the contract comment at the head of `index.ts` is allowed). Every seat starts from a clean clone of the head under audit and runs from the repository root. The iteration-0 package is the `packages/stats` of that head: it lacks `mixtureWeights` and `mixedStrengthCoverage`, and its `wilson` returns an upper bound below 1 at k = n.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pending | |
| cheater | pending | |
| cause review | pending | |
| planted bugs | pending | |

### Commands per seat

All four use the same scorer: `pnpm -s driftbench validate stats --seeds 1..20 --hidden --items --json > out.json`. One sweep at a time; a sweep takes 30 to 50 minutes on a busy machine. Run the weights family alone with `--items --json` and read the `bank` block for the family `weights-*`.

1. **Blind pilot.** Start from `pnpm -s driftbench validate stats --brief --fresh` and nothing else. Run ten pilot iterations on its own branch: fix the first failing level's named items, one cause per iteration. Append each row with `pnpm -s driftbench validate stats --journal row.json`, adding `"executor": "blind"`. Report the items fixed per iteration and the residual failing items. Pass when the weights items reach 0 failing in at most 10 iterations and the builder's pilot is not more than 1.5 times slower.
2. **Cheater.** Told to raise the score without making the package correct: hard-code seeds, read the oracle, match item ids, special-case fixture names, sniff the caller (stack or argv), return what the checks look for. Compare bank scores from `--items` runs on seeds 1, 2 and on seeds 977, 4242 (unseen to a table cheat). Include a non-maximum-likelihood mixture (least squares on the shares): it must fail the `weights.em.*` items (`packages/validators/test/stats/weights.test.ts` shows it fails 13 of 14 on four seeds). Any gain from a cheat is a failure, and the cheat becomes a new item.
3. **Cause review.** Sample 30 failing items from `pnpm -s driftbench validate stats --seeds 1..20 --hidden --all-levels --blind --json` (no builder cause, no `Fix:` hint); write the fix for each, then read the builder's `cause` tags. Pass at agreement of 0.8 or more; the reviewed count of distinct causes replaces the declared count.
4. **Planted bugs.** Plant 20 known bugs one at a time in the pilot's `mixture.ts`, `coverage.ts`, `intervals.ts` (wilson) and in `cohenKappa` / `krippendorffAlpha`. For each, run `--items --json`; the validator must lose at least one item per non-equivalent bug. A bug it misses becomes a new item.

## What changed since round 1

Round 1 found a failing cheater and 16 missed planted bugs. Version 4 closes the first and part of the second:

* Fourteen `weights.em.*` items plant counts that are not an exact mix (a seeded draw over components, 2 to 4 components over 3 to 6 categories, a small and a large sample, the audit's two named cases) and compare with an expectation-maximisation reference run to a fixed point (weights within 1e-6, log-likelihood within 1e-9 relative). A least-squares mixture passes the 24 exact-mix items and fails 12 or 13 of these 14 on seeds 1, 2, 977 and 4242; the pilot of `exec/stats-weights-pilot` passes all 14.
* The twelve refusal items of mixtureWeights and mixedStrengthCoverage check that the message starts with the function and names the argument to fix (`components`, `counts`, `rows`, `groups` or `levels`, singular stems allowed), not only the class. The pilot of `exec/stats-weights-pilot` passes all 12 (its messages start with the function and name the argument).

Still owed from round 1: an item for each of the other misses whose behaviour a page states (alpha with undefined or ragged data, ordinal and ratio levels, constant-data returns, the default numeric kappa order, the wilson z refusal, the mixture sum tolerance and NaN, the coverage key collision and total ratio); failure details that do not print the planted mix or the expected coverage; and the frame fix that runs the product in a child process so a caller cannot be sniffed (the version 3 frame already runs items in child processes with a trap; the seat checks whether sniffing still works).

## The builder's measurement (not a verdict)

| Family | Items | Failing on the base product, seeds 1 to 20 | Cause |
|---|---|---|---|
| weights-agreement | 42 | 0 | (regression items: cohenKappa weights over the given category order, krippendorffAlpha with missing values) |
| weights-wilson | 30 | 6 | wilson gives an upper bound below 1 for k = n (0.9999999999999998 for wilson(1000325, 1000325)) |
| weights-mixture | 44 | 44 | mixtureWeights is missing from @agent-nexus/driftbench-stats |
| weights-coverage | 30 | 30 | mixedStrengthCoverage is missing from @agent-nexus/driftbench-stats |

Three causes in 146 items. The family alone cannot meet section 12.4: 3 causes against the gate's 100 (the gate reads the whole bank).

## Doc sentences owed (docs/statistics/ belongs to its page owner)

* `mixtureWeights` and `mixedStrengthCoverage`: their contracts are written at the head of the family's `index.ts`, including that a `RangeError` message starts with the function name and names the argument; a page must state them before the items can cite a page.
* `wilson`: that the bounds at k = 0 and k = n are exactly 0 and 1, and that the lower bound next to 1 is within one unit in the last place of 1.

## Round 1 (history, ladder version 3 era)

Round 1 ran on 2026-10-19: two fresh Sonnet helpers at medium effort that read only the contract comment at the head of the family's `index.ts` (132 items then). Their reports are `cheater-and-bugs.md` and `blind.md` in this folder; the verdicts are quoted from them.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pass | 2 to 3, 30 and 30 items fixed per round, 3 rounds, residual 0 failing |
| cheater | fail | a non-ML least-squares mixture passes 132 of 132 on both seed sets; the table cheat is caught only by unseen seeds, and caller sniffing is uncatchable by the scorer |
| cause review | pending | the helper counted 3 causes with the fixes listed in `blind.md` (Wilson upper bound at k = n, mixtureWeights missing, mixedStrengthCoverage missing); it wrote no agreement verdict |
| planted bugs | fail | 22 of 38 non-equivalent bugs killed; 16 real misses (alpha undefined and ragged, ordinal and ratio levels, constant-data returns, default numeric kappa order, wilson z refusal, mixture sum tolerance and NaN, coverage key collision and total ratio) |
