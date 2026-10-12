# Product needs of the stats bank methods added in batches 3 and 4

Written 2026-10-12 on lane/v-stats, at the lead's honesty check: a validator must not be made hard with work the product does not need. Each of the 61 methods added in batches 3 and 4 (commits 872186d5 and a41752f3) is listed with the product need that would use it: a docs page, a design section or a command. A method with no such need is quarantined: its cases stay in `packages/validators/fixtures/stats/roadmap.json`, but its items are left out of the bank (`packages/validators/fixtures/stats/needs.json`, read by `bank/roadmap.ts`), so they count toward no score, forecast or cause.

The 101 methods of the earlier batches were not reviewed here.

Result: 5 methods kept, 56 quarantined.

## Kept: a product need names them

| Method | Need (where) | What it would serve |
|---|---|---|
| `designEffectFromData` | docs/generating.md, "What the analysis reports": "the design effect measured from the within-cell conversation correlation"; docs/estate.md, "Not built yet": "the design effect from the measured correlation of the variance pilot" | the pilot and the estate plan compute a design effect from data |
| `iccOneWay` | docs/generating.md, "What the analysis reports": "The intraclass correlation per level"; docs/concepts/statistics.md, "Before a campaign": "pass the rho that icc measures" to mde | the rho the pilot and mde read, for unbalanced conversations |
| `kishWeightDesignEffect` | docs/reference/cli.md, driftbench space coverage: "weighted 34.0% of the declared user mix, effective sample size 6.3 of 7 specs" | the weighted coverage line reports the effective sample size of unequal weights |
| `clusteredMeanInterval` | docs/concepts/statistics.md, opening: "One conversation, or one task, is one cluster" and "reports every rate with an interval"; docs/generating.md: "Pass rate 15.9% (13.3% to 19.0%, Wilson on 638.6 effective runs)"; docs/validators.md section 7: clustered truth | an interval on a rate of clustered runs, without resampling |
| `oneWayAnova` | docs/generating.md, "What the analysis reports": "the cell's wording F test holds at a false discovery rate of 0.05" | the wording F test of the pilot is a one-way ANOVA over wordings |

## Quarantined: no product need found

| Method | Family it was in | Why it is quarantined |
|---|---|---|
| `agrestiCaffoDifference` | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `bartlettTest` | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `bayesFactorRate` | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `betaBinomialMoments` | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `bowkerSymmetry` | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `brunnerMunzel` | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `cauchyCombination` | roadmap-multiplicity | no docs page, design section or command names it or would call it; quarantined until one does |
| `clusterMeansInterval` | roadmap-shrinkage-clustering | serves the same need as clusteredMeanInterval (an interval on clustered runs); one method is enough for that need |
| `cochranMantelHaenszel` | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `cohenH` | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `conditionalPower` | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `cramersV` | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `exhaustiveBootstrapInterval` | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `fisherCombination` | roadmap-multiplicity | no docs page, design section or command names it or would call it; quarantined until one does |
| `geometricMeanInterval` | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `glassDelta` | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `goodmanKruskalGamma` | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `harmonicMeanP` | roadmap-multiplicity | no docs page, design section or command names it or would call it; quarantined until one does |
| `hochberg` | roadmap-multiplicity | docs/concepts/statistics.md names Benjamini-Hochberg across criteria, which exists; no page asks for family-wise control |
| `hoeffdingConfidenceSequence` | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `holmSidak` | roadmap-multiplicity | no page asks for family-wise control; Benjamini-Hochberg is the documented choice |
| `hommel` | roadmap-multiplicity | no page asks for family-wise control; Benjamini-Hochberg is the documented choice |
| `huberLocation` | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `iccInterval` | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `jackknifeVarianceOfVariance` | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `jamesStein` | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `kendallW` | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `likelihoodRatioInterval` | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `logitInterval` | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `mantelHaenszelOddsRatio` | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `matthewsCorrelation` | roadmap-association | judge agreement is documented as Cohen kappa and Krippendorff alpha (docs/concepts/judges.md) |
| `midPInterval` | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `moderatedVariance` | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `moodMedianTest` | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `msprtPValue` | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `normalPosterior` | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `phiCoefficient` | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `pooledDifferenceInterval` | roadmap-small-n | driftbench compare documents paired comparisons only |
| `pooledVariance` | roadmap-shrinkage-clustering | a sub-quantity of the wording F test (its mean square within); the need is met by oneWayAnova |
| `probabilityBetter` | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `quantileInterval` | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `ratioEstimate` | roadmap-shrinkage-clustering | block pass rates over conversations of unequal length are not reported by any page today |
| `remlOneWay` | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `shrinkRates` | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `sidak` | roadmap-multiplicity | no page asks for family-wise control; Benjamini-Hochberg is the documented choice |
| `simesTest` | roadmap-multiplicity | no docs page, design section or command names it or would call it; quarantined until one does |
| `sprtExpectedSampleSize` | roadmap-sequential | docs/concepts/run-modes.md plans an early stop by a fixed rule (the first two repeats both fail), not an SPRT |
| `sprtOperatingCharacteristic` | roadmap-sequential | same as sprtExpectedSampleSize: the planned early stop is a fixed rule, not an SPRT |
| `storeyQValues` | roadmap-multiplicity | Benjamini-Hochberg is the documented false discovery rate procedure; no page needs pi0 |
| `stoufferCombination` | roadmap-multiplicity | no docs page, design section or command names it or would call it; quarantined until one does |
| `varianceInterval` | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `varianceRatioInterval` | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `waldDifference` | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `welchAnova` | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `welchDifferenceInterval` | roadmap-small-n | driftbench compare documents paired comparisons only |
| `zeroFailureBayesN` | roadmap-sequential | zeroFailureBound (documented) answers the zero-failure question; no page asks for a Bayesian version |

## Effect on the hardness measurement

With the 56 quarantined methods out, the bank holds 1365 items (from 1776). `driftbench validate stats --hardness`:

```
Hardness of stats (docs/validators.md section 12.4), from validators/stats/journal.jsonl
Bank at iteration 10: 1365 items, 471 pass on every seed.
Family                    tier 1  tier 2  tier 3  tier 4  tier 5  tier none  items  failing
Score at iteration 0: 0.3121 (426 of 1365).
Score after the pilot: 0.3451 (471 of 1365, iteration 10; 10 of 10 pilot iterations).
Items fixed per iteration: 4.5 (mean over the pilot).
Forecast: 198.7 iterations to 100 percent (894 failing / 4.5).
Distinct failing causes after the pilot: 127 (0 failing items name no cause and count as their own).
Gate: NOT MET: audit.md is absent: no validator merges without the audit (12.7).
Bank minimum at merge (12.1): holds.
Audit: validators/stats/audit.md is absent.
```

A quarantined method returns to the bank when a docs page, a design section or a command names it: move its entry from `quarantine` to `keep` in `needs.json` with the citation.
