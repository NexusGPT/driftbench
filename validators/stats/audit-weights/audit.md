# Audit of the weights family of the statistics bank (docs/validators.md section 12.7)

The family is `packages/validators/src/ladders/stats/bank/weights/`, 132 items in four families, all at the `capabilities` level. Round 1 ran on 2026-10-19: two fresh Sonnet helpers at medium effort that read only the contract comment at the head of the family's `index.ts`, never its items. Their reports are `cheater-and-bugs.md` and `blind.md` in this folder; every verdict below is quoted from them.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pass | 2 to 3, 30 and 30 items fixed per round, 3 rounds, residual 0 failing |
| cheater | fail | a non-ML least-squares mixture passes 132 of 132 on both seed sets; the table cheat is caught only by unseen seeds, and caller sniffing is uncatchable by the scorer |
| cause review | pending | the helper counted 3 causes with the fixes listed in `blind.md` (Wilson upper bound at k = n, mixtureWeights missing, mixedStrengthCoverage missing); it wrote no agreement verdict |
| planted bugs | fail | 22 of 38 non-equivalent bugs killed; 16 real misses (alpha undefined and ragged, ordinal and ratio levels, constant-data returns, default numeric kappa order, wilson z refusal, mixture sum tolerance and NaN, coverage key collision and total ratio) |

Owed: items that tell an EM estimate from any consistent estimator (counts that are not an exact mix, compared with an EM reference at a stated tolerance), refusal items that check the error, not only its class, failure details that do not print the expected values, an item for each of the 16 misses whose behaviour a page states, and the frame fix that runs the product in a child process (caller sniffing). Then round 2.

## The builder's measurement (not a verdict)

| Family | Items | Failing on the base product, seeds 1 to 20 | Cause |
|---|---|---|---|
| weights-agreement | 42 | 0 | (regression items: cohenKappa weights over the given category order, krippendorffAlpha with missing values) |
| weights-wilson | 30 | 6 | wilson gives an upper bound below 1 for k = n (0.9999999999999998 for wilson(1000325, 1000325)) |
| weights-mixture | 30 | 30 | mixtureWeights is missing from @agent-nexus/driftbench-stats |
| weights-coverage | 30 | 30 | mixedStrengthCoverage is missing from @agent-nexus/driftbench-stats |

Iteration 0: 66 of 132 items fail, in 3 causes. The pilot `exec/stats-weights-pilot` (one commit: `mixtureWeights`, `mixedStrengthCoverage`, exact Wilson bounds at k = 0 and k = n) passes 132 of 132 on seeds 1, 2, 3, 977 and 4242, and the statistics package suite passes on it. The family alone cannot meet section 12.4: 3 causes, against the gate's 100.

## Doc sentences owed (docs/statistics/ belongs to its page owner)

- `mixtureWeights` and `mixedStrengthCoverage`: their contracts are written at the head of the family's `index.ts`; a page must state them before the items can cite a page.
- `wilson`: that the bounds at k = 0 and k = n are exactly 0 and 1, and that the lower bound next to 1 is within one unit in the last place of 1.
