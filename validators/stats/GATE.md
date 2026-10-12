# Stats validator: where the gate stands

Status, 2026-10-12: the bank stays at its honest size until the owner decides. The owner will choose between lowering the stats forecast bar to what real needs support and widening the documented scope. No item is added to reach 100 causes. Every item names its need in [NEEDS.md](NEEDS.md).

## The numbers

From `driftbench validate stats --hardness`, at lane/v-stats 37040b62:

| Measure | Value | Gate (docs/validators.md section 12) |
|---|---|---|
| Bank | 644 items, 22 families, tiers 1 to 5 | 300 items, no family under 20, every tier: holds |
| Score at iteration 0 | 0.7516 (484 of 644) | |
| Score after the pilot | 0.8214 (529 of 644) | at most 0.4: not met |
| Items fixed per iteration | 4.5 | |
| Forecast | 25.56 iterations (115 failing / 4.5) | at least 100: not met |
| Distinct failing causes | 37 | at least 100: not met |
| Audit | `audit.md` absent | required |

## The 37 failing causes, by family

Each line gives the cause, then its failing items in brackets.

* product (6, tier 5):
  * campaign plan: the minimum detectable effect from stats.mde [5]
  * campaign plan: a measured rho [3]
  * campaign plan CLI: --rho [1]
  * estate: the session as the unit (sessionRate) [4]
  * report: the run pass interval holds 95 percent with few specs [2]
  * runner: the planned early stop (earlyStop) [1]
* roadmap (7): add clusteredMeanInterval, designEffectFromData, iccOneWay, kishEffectiveSize, oneWayAnova, stratifiedMean, weightedMean [7 or 8 each].
* edge-accuracy (3, tier 4):
  * designEffect: reject rho below -1 / (m - 1) [3]
  * mde: edge inputs [2]
  * zeroFailureBound: edge inputs [1]
* numerical-stability (4, tier 4):
  * varianceComponents: centre the values before the sums [2]
  * mean without overflow [1]
  * betaQuantile on a U-shaped beta [1]
  * Hill number near order 1 [1]
* degenerate-domain (10, tier 2): input validation or domain limits of chiSquareSf, cohenKappa, designEffect, incompleteBeta, krippendorffAlpha, logGamma, mde, neymanAllocation, normalCdf, repeatsForFloor.
* degenerate-single-equal (4, tier 2): exact answers on one or all-equal values from bootstrapCI, mean, sampleVariance, varianceComponents.
* degenerate-nonfinite (1, tier 2): betaQuantile input validation.
* allocation-bruteforce (1, tier 4): neymanAllocation optimal integer allocation [11].
* unseen-known (1, tier 4): chaoCoverage richness within 10 percent just above the class count [3].

## Real product defects: the executor picks these first

The validator found these defects. They are not test artifacts: each one changes a number a user reads.

1. **The report's run pass interval is too narrow.** The scorecard prints a 95 percent interval on each mode's run pass rate, a cluster bootstrap over specs. With 6 specs of 5 repeats (the Acme example's size, rho 0.3) it holds the true rate in about 82 percent of draws. With 20 specs of 3 repeats it holds it in about 92 percent. Items: `simulation.report-run-pass.s6x5` and `.s20x3`. File: `packages/report/src/estimate.ts`.
2. **`campaign plan` uses its own MDE formula.** For the 6 Acme specs with 5 repeats at a 90 percent baseline it prints 21.7 points, where `stats.mde` gives 30.9. With one spec it gives 198.1 points, where `stats.mde` finds no detectable drop. It also has no input for a measured rho. Items: `planned.plan-mde.*`, `planned.plan-rho.*`, `planned.plan-cli.*`. Files: `packages/core/src/runner/campaign.ts`, `packages/cli/src/commands/campaign.ts`.
3. **`mde` throws at a baseline pass rate of 0 or 1.** A pilot where every run passes has a baseline of 1. The documented equation then gives an effect of 0.142 for 50 specs, and no effect (null) at a baseline of 0. Items: `edge.mde.baseline-all-pass` and `edge.mde.baseline-all-fail`. File: `packages/stats/src/power.ts`.
4. **`designEffect` accepts rho below -1 / (m - 1).** `designEffect(10, -0.5)` returns -3.5 and `effectiveSampleSize(100, 10, -0.2)` returns -125. `mde` then returns an effect near 0 from a negative effective sample. Items: `edge.rho-bound.*`. File: `packages/stats/src/intervals.ts`.
5. **`zeroFailureBound` loses precision for a tiny p.** At p 1e-9 it returns 2995732357 runs, where 2995732273 is exact: `log(1 - p)` loses digits that `log1p(-p)` keeps. Item: `edge.zeroFailureBound.p1e-09`. File: `packages/stats/src/intervals.ts`.

Then the planned capabilities that docs pages name: the estate session as the unit (`sessionRate`, docs/estate.md section 7) and the early stop (docs/concepts/run-modes.md).
