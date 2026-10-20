# Weights families, blind pilot and cause review

## Cause table (seeds 1,2: 62 failing; 977,4242: 63 failing)
| # | Failing items | Product behaviour wrong | Contract sentence broken | Fix (file) |
|---|---|---|---|---|
| 1 | weights.near-one.* (2 on 1,2; 3 more on other seeds; all k = n at 1e6/1e9, z 1 or 1.96) | wilson(k, n) with k = n returns upper 0.9999999999999998, not 1: center + half forms a difference of nearly equal numbers | "no difference of nearly equal numbers when the formula allows another way" (capabilities.md, Conventions, Accuracy) | packages/stats/src/intervals.ts, wilson: lower = p^2/(a+b), other bound by symmetry 1 - lower(n-k) |
| 2 | weights.recover.*, weights.refuse.no-component/length-mismatch/row-not-one/entry-outside/fractional-count/all-zero (30) | mixtureWeights not exported | "`mixtureWeights(components, counts, options?)` returns { weights, iterations, logLikelihood }" (contract comment) | new packages/stats/src/mixture.ts, export in index.ts |
| 3 | weights.mixed-strength.*, weights.refuse.no-group/row-length/value-outside/axis-repeated/strength-above/level-zero (30) | mixedStrengthCoverage not exported | "`mixedStrengthCoverage(rows, groups, levels)` returns { groups, covered, required, coverage }" (contract comment) | packages/stats/src/coverage.ts (end), export in index.ts |

Agreement items (kappa linear/quadratic, alpha nominal/interval): 0 failing, no cause.
Causes: 3.

## Rounds
| Round | Failing before | Failing after (1,2 / 977,4242) | Items fixed | sha |
|---|---|---|---|---|
| 1 wilson near 1 | 62 / 63 | 60 / 60 | 2 / 3 | 4142bf2a3 |
| 2 mixtureWeights | 60 | 30 / 30 | 30 | 3f3b9fa50 |
| 3 mixedStrengthCoverage | 30 | 0 / 0 | 30 | 2d8a99f7f |

Final: `pnpm vitest run --maxWorkers=2 packages/stats`: 21 files, 540 tests passed.

blind pilot: pass items fixed 2-3 / 30 / 30 per round, 3 rounds, residual 0 failing (seeds 1,2 and 977,4242)
cause review: 3 causes, fixes as listed
