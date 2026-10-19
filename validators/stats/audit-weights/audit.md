# Audit of the weights family of the statistics bank (docs/validators.md section 12.7)

The family is `packages/validators/src/ladders/stats/bank/weights/`, 132 items in four families, all at the `capabilities` level. No audit helper has run yet: the four checks below are owed to fresh Sonnet helpers that have not read the family's code. The builder writes no verdict.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pending | not run |
| cheater | pending | not run |
| cause review | pending | not run |
| planted bugs | pending | not run |

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
