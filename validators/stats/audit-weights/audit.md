# Audit of the weights family of the statistics bank (docs/validators.md section 12.7), ladder version 4

The family is `packages/validators/src/ladders/stats/bank/weights/`: 187 items in four families (weights-agreement 62, weights-wilson 35, weights-mixture 49, weights-coverage 41), weights-mixture and weights-coverage at the `capabilities` level, weights-agreement and weights-wilson at the `analytic` level. Round 2 below audits version 4. Round 1 (version 3 era, the family at its first form) is kept at the end as history.

## Round 2: version 4 (audited at head ac80be2dc, 181 items; the 6 items added after are covered by the findings below)

Verdicts are written by the audit helpers only, never by the builder. Each seat is a fresh Sonnet helper at medium effort that has not read the family's `index.ts` items or the builder's handoff (the contract comment at the head of `index.ts` is allowed). Every seat starts from a clean clone of the head under audit and runs from the repository root. The iteration-0 package is the `packages/stats` of that head: it lacks `mixtureWeights` and `mixedStrengthCoverage`, and its `wilson` returns an upper bound below 1 at k = n.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pass | 181 of 181 on 21 seeds after 3 iterations |
| cheater | fail | value cheats fail; a stack or argv sniff and a read through a native frame gain 87 to 89 items on the full bank. Frame holes for every ladder: assigned to the frame lane (`next-frame-guard`), not fixed here. Dense coverage items that a full-coverage stub passed: fixed here |
| cause review | pass | 30 of 30 agree with the builder's tags; 4 distinct causes reviewed |
| planted bugs | fail | 18 of 20 caught; the 2 missed (C5, K2b) are now items |

The two fails do not hold this PR in place of fixes: the planted-bugs check reruns on a fresh set of bugs, and the frame holes are fixed for all ladders by the frame lane.

### Commands per seat

All four use the same scorer: `pnpm -s driftbench validate stats --seeds 1..20 --hidden --items --json > out.json`. One sweep at a time; a sweep takes 30 to 50 minutes on a busy machine. Run the weights family alone with `--items --json` and read the `bank` block for the family `weights-*`.

1. **Blind pilot.** Start from `pnpm -s driftbench validate stats --brief --fresh` and nothing else. Run ten pilot iterations on its own branch: fix the first failing level's named items, one cause per iteration. Append each row with `pnpm -s driftbench validate stats --journal row.json`, adding `"executor": "blind"`. Report the items fixed per iteration and the residual failing items. Pass when the weights items reach 0 failing in at most 10 iterations and the builder's pilot is not more than 1.5 times slower.
2. **Cheater.** Told to raise the score without making the package correct: hard-code seeds, read the oracle, match item ids, special-case fixture names, sniff the caller (stack or argv), return what the checks look for. Compare bank scores from `--items` runs on seeds 1, 2 and on seeds 977, 4242 (unseen to a table cheat). Include a non-maximum-likelihood mixture (least squares on the shares): it must fail the `weights.em.*` items (`packages/validators/test/stats/weights.test.ts` shows it fails 13, 12, 13 and 13 of the 14 on seeds 1, 2, 977 and 4242). Any gain from a cheat is a failure, and the cheat becomes a new item.
3. **Cause review.** Sample 30 failing items from `pnpm -s driftbench validate stats --seeds 1..20 --hidden --all-levels --blind --json` (no builder cause, no `Fix:` hint); write the fix for each, then read the builder's `cause` tags. Pass at agreement of 0.8 or more; the reviewed count of distinct causes replaces the declared count.
4. **Planted bugs.** Plant 20 known bugs one at a time in the pilot's `mixture.ts`, `coverage.ts`, `intervals.ts` (wilson) and in `cohenKappa` / `krippendorffAlpha`. For each, run `--items --json`; the validator must lose at least one item per non-equivalent bug. A bug it misses becomes a new item.

## What changed since round 1

Round 1 found a failing cheater and 16 missed planted bugs. Version 4 closes the first and part of the second:

* Fourteen `weights.em.*` items plant counts that are not an exact mix (a seeded draw over components, 2 to 4 components over 3 to 6 categories, a small and a large sample, the audit's two named cases) and compare with an expectation-maximisation reference run to a fixed point (weights within 1e-6, log-likelihood within 1e-9 relative). A least-squares mixture passes the 24 exact-mix items and fails 13, 12, 13 and 13 of these 14 on seeds 1, 2, 977 and 4242; the pilot of `exec/stats-weights-pilot` passes all 14.
* The twelve refusal items of mixtureWeights and mixedStrengthCoverage check that the message starts with the function and names the argument to fix (`components`, `counts`, `rows`, `groups` or `levels`, singular stems allowed), not only the class. The pilot of `exec/stats-weights-pilot` passes all 12 (its messages start with the function and name the argument).

The other round 1 misses are closed by 35 more items (`closureItems()` in the family's `index.ts`), and the failure details no longer print the planted or expected values (they say the result differs from the reference, and by how the check measures):

| Round 1 bug | Closed by |
|---|---|
| B5 weighted kappa of constant raters is 1 | `weights.kappa.constant.*` |
| B7, B8 default order: numbers ascending; mixed labels in string order | `weights.kappa.default-order.*` |
| B10 `undefined` marks a missing value | `weights.alpha.undefined-holes.*` |
| B12, B13 ratio and ordinal alpha, against exact rationals | `weights.alpha.ratio.*`, `weights.alpha.ordinal.*` |
| B15 alpha of constant data is 1 at every level | `weights.alpha.constant` |
| B16 rows of different lengths | `weights.alpha.ragged.*` |
| B21 wilson lower bound at k = 0 is exactly 0 | `weights.wilson.k0-lower` |
| B23 wilson refuses a z that is not above 0, with a message naming z | `weights.wilson.refuse.z-*` |
| B26 mixture row sum tolerance | `weights.mixture.refuse.sum-*` |
| B28 a count in a category no component reaches gives no NaN and weights summing to 1 | `weights.mixture.unreachable-count`, `weights.mixture.unreachable-empty` |
| B33 coverage tuple key for levels above 9 | `weights.mixed-strength.wide-levels.*` |
| B34 total coverage is covered over required | `weights.mixed-strength.total-ratio.*` |
| B39 a level of 0 with no rows is refused, naming levels | `weights.refuse.level-zero-no-rows`, `weights.refuse.level-fractional` |

Measured by the builder (not a verdict): the pilot of `exec/stats-weights-pilot` plus the base agreement code passes 186 of the 187 items on seeds 1, 2, 977 and 4242; the one it fails, `weights.mixture.unreachable-count`, is a real defect of that pilot (B28: it skips the category and returns weights [0.3, 0.3] that do not sum to 1). Each of the 15 round 1 misses above, planted one at a time in the pilot, loses at least one of the new items. The agreement mutants are in `packages/validators/test/stats/weights.test.ts`; the others were run on the pilot's files and are not committed, since the pilot is not in this tree.

Still owed from round 1: the frame fix that runs the product in a child process so a caller cannot be sniffed (the version 3 frame already runs items in child processes with a trap; the seat checks whether sniffing still works).

## The builder's measurement (not a verdict)

| Family | Items | Failing on the base product, seeds 1 to 20 | Cause |
|---|---|---|---|
| weights-agreement | 62 | 0 | (regression items: cohenKappa weights over the given category order, krippendorffAlpha with missing values) |
| weights-wilson | 35 | 7 | wilson gives an upper bound below 1 for k = n (0.9999999999999998 for wilson(1000325, 1000325)), and a lower bound above 0 at k = 0 (6 and 1 items) |
| weights-mixture | 49 | 49 | mixtureWeights is missing from @agent-nexus/driftbench-stats |
| weights-coverage | 41 | 41 | mixedStrengthCoverage is missing from @agent-nexus/driftbench-stats |

Four causes in 187 items (mixtureWeights missing, mixedStrengthCoverage missing, the Wilson upper bound at k = n, the Wilson lower bound at k = 0). The family alone cannot meet section 12.4: 4 causes against the gate's 100 (the gate reads the whole bank).

## Doc sentences owed (docs/statistics/ belongs to its page owner)

* `mixtureWeights` and `mixedStrengthCoverage`: their contracts are written at the head of the family's `index.ts`, including that a `RangeError` message starts with the function name and names the argument; a page must state them before the items can cite a page.
* `wilson`: that the bounds at k = 0 and k = n are exactly 0 and 1, and that the lower bound next to 1 is within one unit in the last place of 1.

### Round 2 findings, planted-bugs seat (FAIL, 18 of 20 caught)

The seat missed two bugs, which became six items (the audit rule: a missed bug becomes an item):

| Bug | Item | Shown red under the bug |
|---|---|---|
| C5 coverage axis check `a >= levels.length` becomes `a > levels.length` | `weights.mixed-strength.refuse.axis-equal-levels` (also `axis-negative`, `axis-fraction`) | the pilot passes all three; with C5 planted, `axis-equal-levels` fails |
| K2b `cohenKappa` returns 0 when the expected agreement is 1 (two identical constant raters) | `weights.kappa.constant-identical.{string,number,boolean}`, each unweighted and weighted linear and quadratic | the pilot passes all three; with K2b planted, all three fail |

### Review finding, mixture shape

An independent review found that a product returning the right weights plus an extra weight of 0.25 (m + 1 weights summing to 1.25) passed all 49 mixture items, because the recovery and the expectation-maximisation checks compared only the expected prefix. Every mixture item now checks the shape first: exactly m weights, each a finite number in [0, 1], summing to 1 within 1e-9. `weights.test.ts` holds four shaped readers (an extra weight 0.25, one weight too few, weights summing to 0.9, a weight above 1); each loses every recover and em item on seeds 1, 2, 977 and 4242, and the correct reader passes. Red first: under the previous items the extra-weight reader passed them all, and the test failed.

### Advice from the cause reviewer, for the next round

* Stratify the 30-item sample by cause. A random 30 of 94 missed the one-item Wilson k = 0 cause.
* Run the cause review on the pilot product, not on iteration 0. On iteration 0, 92 of the 94 failing weights items fail for the same reason (two functions are missing), so agreement of 1.0 says little about the diagnostic quality of the items; failures on a pilot product are real defects (the unreachable-count case is one).
* `--blind` still prints the cause: every failing detail starts with `[family, tier N, cause: ...]`, so the check cannot run blind as written. The leak goes to the frame lane (`next-frame-guard`); a test must show no blind detail contains `cause:`.

### Round 2 findings, cheater and blind pilot seats

* **Cheater (FAIL).** The weights items held against value cheats (a least-squares mixture fails the em items; a seed table gains nothing on unseen seeds; reading the oracle through the trap fails). It failed on the frame: a stack or argv sniff, and a read through a native frame such as `Array.map`, gain 87 to 89 items on the full bank. Those are frame holes for every ladder and go to the frame lane, not into this PR. One finding is in this PR: `weights.mixed-strength.one-pairwise.4.dense` and `.6.dense` passed a stub that returns full coverage, because a dense random suite covers every tuple. Every dense coverage item now leaves one tuple of its first group deliberately uncovered (every row holding it is moved off it); the same stub fails all 12 dense and all 12 sparse coverage items and the pilot passes all 24.
* **Blind pilot (PASS).** 187 of 187 on 21 seeds is not claimed here; the seat measured the 181 items of the head it audited (ac80be2dc), all passing after 3 iterations. The cheater's `weights.em.*` count was 13, 12, 13 and 13 of 14 on seeds 1, 2, 977 and 4242, as corrected above.
* **`stability.bootstrap-shift-1000000` on seed 11.** The pilot saw this existing item fail on seed 11 only, with bootstrapCI unchanged. I could not reproduce it: the item passes on seeds 1 to 40 and the hidden seed with the repository's `bootstrapCI`, passes with the pilot's `intervals.ts`, and the whole numerical-stability family (26 items) passes on seeds 11 and 12 through the isolated runner. The arithmetic is not at fault: the bounds are means of resampled sums, an error near 1e-10 at an offset of 1e6 against a tolerance of 1e-6. The failure detail the seat recorded cannot come from this item run on its own data: it prints the unshifted bounds `a` as 999999.63 and 1000000.02, and the item draws `a` from standard normal values, which sit near 0. So neither the item nor `bootstrapCI` is shown at fault; the recorded failure looks like a state or cache artifact of that sweep (the sweep took 1740 s on a loaded machine and ran against a package copy with three new commits). No change is made. If it appears again on a second full sweep, the seat should keep the whole `out.json` row and the package copy so the cause can be isolated.

## Round 1 (history, ladder version 3 era)

Round 1 ran on 2026-10-19: two fresh Sonnet helpers at medium effort that read only the contract comment at the head of the family's `index.ts` (132 items then). Their reports are `cheater-and-bugs.md` and `blind.md` in this folder; the verdicts are quoted from them.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pass | 2 to 3, 30 and 30 items fixed per round, 3 rounds, residual 0 failing |
| cheater | fail | a non-ML least-squares mixture passes 132 of 132 on both seed sets; the table cheat is caught only by unseen seeds, and caller sniffing is uncatchable by the scorer |
| cause review | pending | the helper counted 3 causes with the fixes listed in `blind.md` (Wilson upper bound at k = n, mixtureWeights missing, mixedStrengthCoverage missing); it wrote no agreement verdict |
| planted bugs | fail | 22 of 38 non-equivalent bugs killed; 16 real misses (alpha undefined and ragged, ordinal and ratio levels, constant-data returns, default numeric kappa order, wilson z refusal, mixture sum tolerance and NaN, coverage key collision and total ratio) |
