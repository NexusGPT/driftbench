# Product needs of the stats bank roadmap methods

Rule (the lead, 2026-10-12): a validator must not be made hard with work the product does not need. Every roadmap method of the stats bank, the 101 of the earlier batches and the 61 of batches 3 and 4, is listed with the product need that would use it: a docs page, a design section or a command. A method with no such need is quarantined. Its cases stay in `packages/validators/fixtures/stats/roadmap.json`, but `needs.json` keeps its items out of the bank (read by `bank/roadmap.ts`), so they count toward no score, forecast or cause. A method returns to the bank when a page names it: move its entry from `quarantine` to `keep` in `needs.json` with the citation.

Result: 7 of 162 methods kept, 155 quarantined.

## Kept: a product need names them

| Method | Batch | Need (where) | What it would serve |
|---|---|---|---|
| `clusteredMeanInterval` | 3 and 4 | docs/concepts/statistics.md, opening: "One conversation, or one task, is one cluster" and "reports every rate with an interval"; docs/generating.md: "Pass rate 15.9% (13.3% to 19.0%, Wilson on 638.6 effective runs)"; docs/validators.md section 7: clustered truth | an interval on a rate of clustered runs, without resampling |
| `designEffectFromData` | 3 and 4 | docs/generating.md, "What the analysis reports": "the design effect measured from the within-cell conversation correlation"; docs/estate.md, "Not built yet": "the design effect from the measured correlation of the variance pilot" | the pilot and the estate plan compute a design effect from data |
| `iccOneWay` | 3 and 4 | docs/generating.md, "What the analysis reports": "The intraclass correlation per level"; docs/concepts/statistics.md, "Before a campaign": "pass the rho that icc measures" to mde | the rho the pilot and mde read, for unbalanced conversations |
| `kishEffectiveSize` | 1 and 2 | docs/reference/cli.md, driftbench space coverage: "weighted 34.0% of the declared user mix, effective sample size 6.3 of 7 specs" | the effective sample size the weighted coverage line prints |
| `oneWayAnova` | 3 and 4 | docs/generating.md, "What the analysis reports": "the cell's wording F test holds at a false discovery rate of 0.05" | the wording F test of the pilot is a one-way ANOVA over wordings |
| `stratifiedMean` | 1 and 2 | docs/generating.md, "What the analysis reports": "The Neyman allocation of an estimation pool of --pool conversations across the cells"; docs/concepts/statistics.md, neymanAllocation | the estimate (and its variance) from the stratified estimation pool that Neyman allocation draws |
| `weightedMean` | 1 and 2 | docs/reference/cli.md, driftbench space coverage: "weighted 34.0% of the declared user mix"; docs/generating.md, space coverage "weighted by the declared prior" | the share of the user mix covered is a weighted mean of covered flags |

## Quarantined: no product need found

| Method | Batch | Family it was in | Why |
|---|---|---|---|
| `aceEstimator` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `agrestiCaffoDifference` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `agrestiCoull` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `alphaSpending` | 1 and 2 | roadmap-sequential | no page plans interim looks at a campaign |
| `arcsineInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `aucRoc` | 1 and 2 | roadmap-calibration | judges return verdicts, not scores (docs/concepts/judges.md) |
| `autocorrelation` | 1 and 2 | roadmap-trend | no docs page, design section or command names it or would call it; quarantined until one does |
| `bartlettTest` | 3 and 4 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `bayesFactorRate` | 3 and 4 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `benjaminiYekutieli` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `betaBinomialMoments` | 3 and 4 | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `betaPosteriorBelow` | 1 and 2 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `betaPosteriorInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `binomialTest` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `bonferroni` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `bowkerSymmetry` | 3 and 4 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `bradleyTerry` | 1 and 2 | roadmap-ratings | no docs page, design section or command names it or would call it; quarantined until one does |
| `brennanPrediger` | 1 and 2 | roadmap-agreement | agreement is documented as Cohen kappa and Krippendorff alpha |
| `brierScore` | 1 and 2 | roadmap-calibration | judges return verdicts, not probabilities (docs/concepts/judges.md) |
| `brunnerMunzel` | 3 and 4 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `cauchyCombination` | 3 and 4 | roadmap-multiplicity | no docs page, design section or command names it or would call it; quarantined until one does |
| `chao1Interval` | 1 and 2 | roadmap-diversity | chaoCoverage (documented) returns Chao1; no page prints an interval on it |
| `chao2` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `chaoShannon` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `chiSquareGoodnessOfFit` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `chiSquareIndependence` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `classificationReport` | 1 and 2 | roadmap-calibration | judge agreement is documented as Cohen kappa against labels (docs/concepts/judges.md) |
| `cliffsDelta` | 1 and 2 | roadmap-correlation | no docs page, design section or command names it or would call it; quarantined until one does |
| `clusterMeansInterval` | 3 and 4 | roadmap-shrinkage-clustering | serves the same need as clusteredMeanInterval (an interval on clustered runs); one method is enough for that need |
| `clusterSampleSize` | 1 and 2 | roadmap-power | no docs page, design section or command names it or would call it; quarantined until one does |
| `clusteredStandardError` | 1 and 2 | roadmap-weighting | its need (a rate of clustered runs) is served by clusteredMeanInterval, which computes it |
| `cochranMantelHaenszel` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `cochranQ` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `cohenH` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `cohensD` | 1 and 2 | roadmap-correlation | no docs page, design section or command names it or would call it; quarantined until one does |
| `conditionalPower` | 3 and 4 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `confidenceSequence` | 1 and 2 | roadmap-sequential | docs/traces.md monitors drift with CUSUM, Page-Hinkley and KS; no page watches a rate continuously with an interval |
| `cramersV` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `effectiveSizeAutocorrelated` | 1 and 2 | roadmap-trend | no docs page, design section or command names it or would call it; quarantined until one does |
| `eloRatings` | 1 and 2 | roadmap-ratings | no docs page, design section or command names it or would call it; quarantined until one does |
| `eloUpdate` | 1 and 2 | roadmap-ratings | no docs page, design section or command names it or would call it; quarantined until one does |
| `ewma` | 1 and 2 | roadmap-trend | no docs page, design section or command names it or would call it; quarantined until one does |
| `excessKurtosis` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `exhaustiveBootstrapInterval` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `expectedCalibrationError` | 1 and 2 | roadmap-calibration | judges return verdicts, not probabilities (docs/concepts/judges.md); calibration there is kappa and separation |
| `extrapolatedRichness` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `fisherCombination` | 3 and 4 | roadmap-multiplicity | no docs page, design section or command names it or would call it; quarantined until one does |
| `fisherExact` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `fleissKappa` | 1 and 2 | roadmap-agreement | agreement across judges is documented as Krippendorff alpha (docs/concepts/judges.md) |
| `friedman` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `gTest` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `geometricMeanInterval` | 3 and 4 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `glassDelta` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `goelOkumoto` | 1 and 2 | roadmap-weighting | no docs page, design section or command names it or would call it; quarantined until one does |
| `goelOkumotoFit` | 1 and 2 | roadmap-weighting | no docs page, design section or command names it or would call it; quarantined until one does |
| `goodmanKruskalGamma` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `gwetAC1` | 1 and 2 | roadmap-agreement | agreement across judges is documented as Krippendorff alpha |
| `harmonicMeanP` | 3 and 4 | roadmap-multiplicity | no docs page, design section or command names it or would call it; quarantined until one does |
| `hillQ2Estimator` | 1 and 2 | roadmap-diversity | hillNumbers (documented) reports the plug-in Hill numbers; no page asks for a bias-corrected estimator |
| `hochberg` | 3 and 4 | roadmap-multiplicity | docs/concepts/statistics.md names Benjamini-Hochberg across criteria, which exists; no page asks for family-wise control |
| `hodgesLehmann` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `hoeffdingConfidenceSequence` | 3 and 4 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `hoeffdingInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `hoeffdingSampleSize` | 1 and 2 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `holm` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `holmSidak` | 3 and 4 | roadmap-multiplicity | no page asks for family-wise control; Benjamini-Hochberg is the documented choice |
| `hommel` | 3 and 4 | roadmap-multiplicity | no page asks for family-wise control; Benjamini-Hochberg is the documented choice |
| `huberLocation` | 3 and 4 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `iChao1` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `icc21` | 1 and 2 | roadmap-agreement | agreement is documented as Cohen kappa and Krippendorff alpha |
| `iccInterval` | 3 and 4 | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `importanceWeights` | 1 and 2 | roadmap-weighting | space coverage weights cells by the declared prior; no page reweights a generator to a user mix |
| `interquartileRange` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `jackknifeRichness` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `jackknifeVarianceOfVariance` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `jamesStein` | 3 and 4 | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `jeffreys` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `kendallTau` | 1 and 2 | roadmap-correlation | no docs page, design section or command names it or would call it; quarantined until one does |
| `kendallW` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `kishWeightDesignEffect` | 3 and 4 | roadmap-weighting | the need (the weighted effective sample size of space coverage) is served by kishEffectiveSize, which prints that figure; one method is enough |
| `kruskalWallis` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `leveneTest` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `likelihoodRatioInterval` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `ljungBox` | 1 and 2 | roadmap-trend | no docs page, design section or command names it or would call it; quarantined until one does |
| `logLoss` | 1 and 2 | roadmap-calibration | judges return verdicts, not probabilities (docs/concepts/judges.md) |
| `logitInterval` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `mannKendall` | 1 and 2 | roadmap-trend | no docs page, design section or command names it or would call it; quarantined until one does |
| `mannWhitneyU` | 1 and 2 | roadmap-tests | distribution shifts are documented with the KS test (docs/concepts/statistics.md, docs/generating.md) |
| `mantelHaenszelOddsRatio` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `matthewsCorrelation` | 3 and 4 | roadmap-association | judge agreement is documented as Cohen kappa and Krippendorff alpha (docs/concepts/judges.md) |
| `mcnemarMidP` | 1 and 2 | roadmap-tests | mcnemar (documented) gives the exact and the chi-square test |
| `mcnemarSampleSize` | 1 and 2 | roadmap-power | no docs page, design section or command names it or would call it; quarantined until one does |
| `medianAbsoluteDeviation` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `medianInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `midPInterval` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `moderatedVariance` | 3 and 4 | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `moodMedianTest` | 3 and 4 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `msprtPValue` | 3 and 4 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `newcombeDifference` | 1 and 2 | roadmap-intervals | driftbench compare documents paired comparisons only; the paired Newcombe interval exists (pairedRateDifference) |
| `nonInferioritySampleSize` | 1 and 2 | roadmap-power | no docs page, design section or command names it or would call it; quarantined until one does |
| `normalPosterior` | 3 and 4 | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `normalSampleSize` | 1 and 2 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `oddsRatioInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `oneSampleT` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `pairedStandardError` | 1 and 2 | roadmap-weighting | no docs page, design section or command names it or would call it; quarantined until one does |
| `pairedT` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `pearson` | 1 and 2 | roadmap-correlation | no docs page, design section or command names it or would call it; quarantined until one does |
| `percentAgreement` | 1 and 2 | roadmap-agreement | agreement is documented as Cohen kappa and Krippendorff alpha |
| `permutationTest` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `phiCoefficient` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `pielouEvenness` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `poissonInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `poissonRateRatioInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `pooledDifferenceInterval` | 3 and 4 | roadmap-small-n | driftbench compare documents paired comparisons only |
| `pooledVariance` | 3 and 4 | roadmap-shrinkage-clustering | a sub-quantity of the wording F test (its mean square within); the need is met by oneWayAnova |
| `powerTwoProportions` | 1 and 2 | roadmap-power | no docs page, design section or command names it or would call it; quarantined until one does |
| `probabilityBetter` | 3 and 4 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `quantileInterval` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `rarefiedRichness` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `ratioEstimate` | 3 and 4 | roadmap-shrinkage-clustering | block pass rates over conversations of unequal length are not reported by any page today |
| `relativeRiskInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `remlOneWay` | 3 and 4 | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `scottPi` | 1 and 2 | roadmap-agreement | agreement is documented as Cohen kappa and Krippendorff alpha |
| `senSlope` | 1 and 2 | roadmap-trend | no docs page, design section or command names it or would call it; quarantined until one does |
| `shannonEntropy` | 1 and 2 | roadmap-diversity | hillNumbers (documented) gives exp(Shannon) as q1 |
| `shrinkRates` | 3 and 4 | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `sidak` | 3 and 4 | roadmap-multiplicity | no page asks for family-wise control; Benjamini-Hochberg is the documented choice |
| `signTest` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `simesTest` | 3 and 4 | roadmap-multiplicity | no docs page, design section or command names it or would call it; quarantined until one does |
| `simpsonIndex` | 1 and 2 | roadmap-diversity | hillNumbers (documented) gives the inverse Simpson as q2 |
| `skewness` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `spearman` | 1 and 2 | roadmap-correlation | no docs page, design section or command names it or would call it; quarantined until one does |
| `sprtBernoulli` | 1 and 2 | roadmap-sequential | docs/concepts/run-modes.md plans an early stop by a fixed rule, not an SPRT |
| `sprtExpectedSampleSize` | 3 and 4 | roadmap-sequential | docs/concepts/run-modes.md plans an early stop by a fixed rule (the first two repeats both fail), not an SPRT |
| `sprtOperatingCharacteristic` | 3 and 4 | roadmap-sequential | same as sprtExpectedSampleSize: the planned early stop is a fixed rule, not an SPRT |
| `storeyQValues` | 3 and 4 | roadmap-multiplicity | Benjamini-Hochberg is the documented false discovery rate procedure; no page needs pi0 |
| `stoufferCombination` | 3 and 4 | roadmap-multiplicity | no docs page, design section or command names it or would call it; quarantined until one does |
| `tInterval` | 1 and 2 | roadmap-intervals | docs/traces.md reports a window mean with its standard error, not an interval; no page asks for a t interval |
| `tostEquivalence` | 1 and 2 | roadmap-power | no docs page, design section or command names it or would call it; quarantined until one does |
| `trimmedMean` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `turingAdjustedCounts` | 1 and 2 | roadmap-diversity | goodTuring (documented) gives f1 / n; no page uses adjusted counts |
| `twoProportionSampleSize` | 1 and 2 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `varianceInterval` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `varianceRatioInterval` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `vendiScore` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `waldDifference` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `waldInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `weightedVariance` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `welchAnova` | 3 and 4 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `welchDifferenceInterval` | 3 and 4 | roadmap-small-n | driftbench compare documents paired comparisons only |
| `welchTTest` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `wilsonContinuity` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `winRate` | 1 and 2 | roadmap-ratings | no docs page, design section or command names it or would call it; quarantined until one does |
| `winsorizedMean` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `zeroFailureBayesN` | 3 and 4 | roadmap-sequential | zeroFailureBound (documented) answers the zero-failure question; no page asks for a Bayesian version |

## What leaves the audited bank

The stats-v2 audit judges the bank of 1326 items (before batches 3 and 4). Of it, 793 items of 98 methods leave: every roadmap method of batches 1 and 2 except `kishEffectiveSize`, `weightedMean` and `stratifiedMean`. 533 items remain, and the four kept methods of batches 3 and 4 add 31: the bank is 564 items.

## Effect on the hardness measurement

The rows of `bank-scores.jsonl` and the journal drop the quarantined items; every remaining item keeps its recorded verdict. `driftbench validate stats --hardness`:

```
Hardness of stats (docs/validators.md section 12.4), from validators/stats/journal.jsonl
Bank at iteration 10: 564 items, 471 pass on every seed.
Score at iteration 0: 0.7553 (426 of 564).
Score after the pilot: 0.8351 (471 of 564, iteration 10; 10 of 10 pilot iterations).
Items fixed per iteration: 4.5 (mean over the pilot).
Forecast: 20.67 iterations to 100 percent (93 failing / 4.5).
Distinct failing causes after the pilot: 28 (0 failing items name no cause and count as their own).
Gate: NOT MET: the forecast 20.67 is under 100: extend the bank (12.2); the score after the pilot 0.8351 is above 0.4; 28 distinct failing causes after the pilot, under 100: extend the bank (12.2); audit.md is absent: no validator merges without the audit (12.7).
Bank minimum at merge (12.1): not met: no item of tier 5.
Audit: validators/stats/audit.md is absent.
```

Without the unneeded roadmap, the stats bank does not meet the hardness contract. The gate fails on the forecast (20.67, under 100), the score after the pilot (0.8351, above 0.4), the distinct causes (28, under 100) and the bank minimum (no tier 5 item). Meeting it honestly needs items on capabilities the product documents, written as items before they are fixed: for example, the planned uses that `docs/concepts/statistics.md` and `docs/estate.md` list as not built (mde with a measured rho in `campaign plan`, the session as the unit in the estate plan), and the planned early stop of `docs/concepts/run-modes.md`.
