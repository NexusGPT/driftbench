/** Statistics: intervals, clustered and hierarchical intervals, reliability, paired tests, multiple comparisons, power, non-inferiority, drift, agreement, variance components and coverage. */
export const packageName = '@agent-nexus/driftbench-stats';

export {
  type AlphaLevel,
  type AlphaResult,
  cohenKappa,
  gwetAc1,
  type KappaIntervalOptions,
  type KappaIntervalResult,
  type KappaOptions,
  type KappaResult,
  kappaInterval,
  krippendorffAlpha,
  type Label,
  weightedKappa,
} from './agreement';
export { kishDesignEffect, proportionalAllocation } from './allocation';
export { mean, mulberry32, quantile, quantileSorted, sampleVariance, weightedMean } from './basics';
export { betaTailProbability } from './bayes';
export { balancedAccuracy, type ConfusionTable, fBeta } from './classification';
export { simesPValue } from './combine';
export {
  abundances,
  type ChaoResult,
  chaoCoverage,
  type GoodTuringResult,
  goodTuring,
  type HillNumbers,
  hillNumber,
  hillNumbers,
} from './coverage';
export { median } from './descriptive';
export { minimumDetectableMeanDifference } from './design-power';
export { totalVariationDistance } from './divergence';
export {
  type Alarm,
  type CusumOptions,
  type CusumResult,
  cusum,
  type KsResult,
  kolmogorovSf,
  ksTest,
  type PageHinkleyOptions,
  type PageHinkleyResult,
  pageHinkley,
} from './drift';
export {
  type ClusterCount,
  type EffectiveWilson,
  type EffectiveWilsonOptions,
  wilsonEffective,
} from './effective';
export { eValueAverage } from './evalues';
export { hypergeometricPmf, signTestExact } from './exact';
export {
  type HierarchicalInterval,
  type HierarchicalOptions,
  hierarchicalBetaBinomial,
  type TreeCount,
} from './hierarchical';
export {
  type BootstrapInterval,
  type BootstrapOptions,
  bootstrapCI,
  clopperPearson,
  clusteredMeanInterval,
  designEffect,
  effectiveSampleSize,
  type Interval,
  kishEffectiveSize,
  ruleOfThreeUpperBound,
  wilson,
  Z95,
  zeroFailureBound,
  zFor,
} from './intervals';
export { geometricMean, harmonicMean } from './means';
export {
  type GroupCoverage,
  type MixedStrengthCoverageResult,
  mixedStrengthCoverage,
  type StrengthGroup,
} from './mixed-strength';
export {
  type MixtureWeightsOptions,
  type MixtureWeightsResult,
  mixtureWeights,
} from './mixture';
export { type BenjaminiHochbergResult, benjaminiHochberg, type HolmResult, holm } from './multiple';
export { wilcoxonSignedRankExactP } from './nonparametric';
export {
  type McNemarMidPResult,
  type McNemarOptions,
  type McNemarResult,
  mcnemar,
  mcnemarMidP,
  type NonInferiorityInput,
  type NonInferiorityResult,
  nonInferiority,
  type OneWayAnovaResult,
  oneWayAnova,
  type PairedDifference,
  type PairedTable,
  pairedRateDifference,
  type WilcoxonMethod,
  type WilcoxonOptions,
  type WilcoxonResult,
  wilcoxonSignedRank,
} from './paired';
export {
  type MdeInput,
  type MdeResult,
  mde,
  type SampleSizeForEffectInput,
  type SampleSizeForEffectResult,
  sampleSizeForEffect,
} from './power';
export { bonferroniThreshold, familywiseErrorRate, sidakThreshold } from './rates';
export { passAtK, passK, unreliability } from './reliability';
export { parseRepeatReducer, type RepeatReducer, reduceRepeats } from './repeat-reducers';
export {
  sampleSizeMeanMargin,
  sampleSizeProportionMargin,
  sampleSizeTwoMeans,
  sampleSizeTwoProportions,
} from './sample-size';
export {
  type CoverageCell,
  type CoverageMethod,
  type CoverageOptions,
  type CoverageResult,
  type FamilyCoverageCell,
  type FamilyCoverageMethod,
  type FamilyCoverageResult,
  simulateCoverage,
  simulateFamilyCoverage,
} from './simulate';
export {
  betaQuantile,
  binomialCdf,
  chiSquareSf,
  erfc,
  incompleteBeta,
  logGamma,
  normalCdf,
  normalQuantile,
  normalSf,
} from './special';
export {
  type Component,
  designEffectFromData,
  icc,
  iccOneWay,
  type LevelCorrelation,
  type NeymanInput,
  type NeymanResult,
  neymanAllocation,
  type Observation,
  type RepeatsForFloorInput,
  type RepeatsForFloorResult,
  repeatsForFloor,
  type StratifiedMeanInput,
  stratifiedMean,
  type VarianceComponentsOptions,
  type VarianceComponentsResult,
  varianceComponents,
} from './variance';
export { jackknifeMeanVariance } from './variance-estimates';
