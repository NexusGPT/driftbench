# Advanced labeller scoring contract

These deterministic APIs extend nominal scoring in `packages/judges/src/labeller-analysis.ts`. The base scorer remains compatible; these types and functions are exported through the judges index.

## Shared interpretation

- Nominal APIs retain the base contract: `none` is an implicit real class, null is abstain, empty/unknown/non-string predictions are invalid. Empty or unequal observation arrays and unknown gold throw. Label sets need nonempty unique named definitions.
- CI, confusion, coverage and mapped agreement retain every observation. Abstain and invalid are distinct prediction-only categories with zero gold marginal; no string sentinel can collide.
- Binary PABAK and ordinal weighted kappa reject missing/invalid observations rather than silently applying a nominal or multiclass correction. Their explicit categories are the entire domain; `none` requires an explicit position/category.
- Nominal multi-rater alpha treats null as missing, rejects invalid labels, and reports missing/unpairable units. It must not turn common invalid outputs into agreement.
- No live calls, randomness, classifier word lists or fixture lookup.

## Fixed TypeScript signatures

```ts
import type { LabellerAnswer, LabellerScore, LabelSet } from './labeller';
import type { Interval, KappaResult } from '@agent-nexus/driftbench-stats';

interface LabellerKappaInterval {
  estimate: number; lower: number | null; upper: number | null;
  standardError: number | null; varianceFactor: number | null;
  confidence: number; total: number; status: 'estimated' | 'degenerate';
  method: 'multinomial-delta';
}
function labellerKappaInterval(gold: readonly string[], answers: readonly LabellerAnswer[], labelSet: LabelSet, confidence?: number): LabellerKappaInterval;
function binaryLabellerPabak(gold: readonly string[], answers: readonly LabellerAnswer[], categories: readonly [string, string]): { total: number; agreement: number; pabak: number };
function weightedLabellerKappa(gold: readonly string[], answers: readonly LabellerAnswer[], orderedLabels: readonly string[], weights?: 'linear' | 'quadratic'): KappaResult;
interface LabellerAlphaResult {
  alpha: number | null; observed: number | null; expected: number | null;
  pairable: number; units: number; raters: number; missing: number;
  unpairableUnits: number; status: 'estimated' | 'insufficient';
}
function labellerNominalAlpha(ratings: readonly (readonly LabellerAnswer[])[], labelSet: LabelSet): LabellerAlphaResult;
type LabellerPredictionColumn = { kind: 'label'; label: string } | { kind: 'abstain' } | { kind: 'invalid' };
interface LabellerClassMetrics {
  label: string; support: number; predicted: number; tp: number; fp: number; fn: number;
  precision: number | null; recall: number | null; f1: number | null;
}
interface LabellerConfusion {
  score: LabellerScore; labels: readonly string[];
  predictionColumns: readonly LabellerPredictionColumn[];
  confusion: readonly (readonly number[])[]; byLabel: readonly LabellerClassMetrics[];
}
function labellerConfusion(gold: readonly string[], answers: readonly LabellerAnswer[], labelSet: LabelSet): LabellerConfusion;
interface ScoredLabellerObservation { gold: string; answer: LabellerAnswer; confidence: number }
interface LabellerCoveragePoint {
  threshold: number; total: number; accepted: number; correct: number;
  coverage: number; acceptedAccuracy: number | null; acceptedAccuracyInterval: Interval | null;
  abstentions: number; invalid: number; belowThreshold: number;
}
function labellerCoverageCurve(observations: readonly ScoredLabellerObservation[], labelSet: LabelSet, thresholds: readonly number[], confidence?: number): LabellerCoveragePoint[];
interface LabellerThresholdOptions { thresholds: readonly number[]; minAccuracy: number; minCoverage?: number; confidence?: number }
function selectLabellerThreshold(observations: readonly ScoredLabellerObservation[], labelSet: LabelSet, options: LabellerThresholdOptions): LabellerCoveragePoint | null;
interface LabellerLabelMapping { source: string; target: string }
interface LabellerMappingOptions {
  goldSet: LabelSet; answerSet: LabelSet; targetSet: LabelSet;
  goldMap: readonly LabellerLabelMapping[]; answerMap: readonly LabellerLabelMapping[];
}
function scoreMappedLabeller(gold: readonly string[], answers: readonly LabellerAnswer[], options: LabellerMappingOptions): LabellerScore;
interface LabellerSamplePlan {
  sampleSize: number; kappa: number; varianceFactor: number; confidence: number; margin: number;
  method: 'multinomial-delta'; assumption: 'iid-fixed-joint';
}
function planLabellerKappaSample(joint: readonly (readonly number[])[], options: { margin: number; confidence?: number }): LabellerSamplePlan;
interface LabellerExactTest {
  kappa: number; pValue: number; permutations: number; extreme: number;
  alternative: 'greater' | 'less' | 'two-sided'; method: 'exact-fixed-margin-permutation';
}
function exactLabellerKappaTest(gold: readonly string[], answers: readonly LabellerAnswer[], labelSet: LabelSet, alternative?: 'greater' | 'less' | 'two-sided'): LabellerExactTest;
```

Optional defaults: confidence is 0.95, weighted mode is `linear`, and the exact-test alternative is `two-sided`.

## Method decisions and edges

1. Kappa CI: independent units with multinomial empirical joint cell probabilities p. po=sum diagonal; pe=sum rowMarginal*columnMarginal; k=(po-pe)/(1-pe). Cell derivative `g_ab = I(a=b)/(1-pe) + (po-1)*(columnMarginal[a]+rowMarginal[b])/(1-pe)^2`. Variance factor `V=sum(p*g*g)-(sum(p*g))^2`; standard error sqrt(V/n). Two-sided normal CI k +/- z*SE clipped to [-1,1], where z is the normal critical value for confidence. This is an asymptotic delta-method interval for kappa, NOT a raw-agreement binomial interval. If n<2, pe=1, or V<=1e-15, status degenerate with null interval, SE and varianceFactor (estimate remains base kappa). Confidence strictly between 0 and 1. Representable values near either endpoint remain valid; floating-point complement rounding must not replace finite critical values or exact binomial bounds with endpoint artifacts.
2. PABAK: exactly two distinct nonblank category names; arrays must contain only these two classes. PABAK=2*agreement-1. Unsupported multiclass, abstain and invalid throw. Single observed class is permitted within a declared binary domain.
3. Weighted kappa: at least two unique ordered nonblank names, linear or quadratic disagreement distance, delegate kappa to stats cohenKappa with explicit categories; return observed/expected agreement normalized by maximum disagreement distance (K-1 for linear, (K-1)^2 for quadratic), both in [0,1]. Null/unknown throw. Perfect constant observations use stats finite convention 1. Missing ordinal positions or `none` absent from order are errors.
4. Alpha: rectangular nonempty raters-by-units matrix, at least two raters. Null is missing; no undefined holes accepted. Delegate nominal alpha to stats primitive after validation. Units with fewer than two observed ratings are excluded from coincidence computation and counted. No pairable units -> insufficient, null alpha/observed/expected, pairable=0. Constant pairable ratings -> alpha=1 (stats convention, not evidence of discrimination).
5. Confusion: row order is declared label order plus implicit none if absent; columns same plus typed abstain and invalid descriptors. Invalid and abstain create FN for their gold class, not FP for any named class. precision is null with zero predicted, recall null with zero support, f1 null when 2tp+fp+fn=0, otherwise 2tp/(2tp+fp+fn).
6. Coverage: every confidence and threshold finite in [0,1], thresholds nonempty, deduplicated and sorted ascending. Accept iff valid class and confidence>=threshold. Null and invalid never accepted. acceptedAccuracy=null and interval=null at zero accepted. Exact Clopper-Pearson interval on accepted accuracy uses 1-confidence; this descriptive interval is not simultaneous or post-selection coverage. Selector chooses highest coverage satisfying empirical accuracy>=minAccuracy and coverage>=minCoverage (default 0), requires accepted>0, tie lower threshold; otherwise null. Threshold selection requires independent held-out validation before deployment claims.
7. Mapping: both gold and answer vocabularies mapped EXPLICITLY and TOTALLY (including none) into a common target vocabulary. Renames and split-child-to-common-parent collapses supported. Duplicate source rows (even same target), absent rows, unknown sources/targets throw. One source to multiple targets is ambiguous and rejected. Unknown answer stays invalid; null stays abstain. Gold must belong to goldSet before mapping. This compares after the declared mapping and does not claim recovery of split information.
8. Sample planner: square joint probability matrix >=2 categories, finite nonnegative entries summing to 1 within 1e-10. No silent renormalization. Assumes iid units and this fixed joint distribution. Same delta variance V; n=max(2,ceil(z^2*V/margin^2)), margin strictly (0,1). Reject pe=1 and V<=1e-15. Returns assumed precision, NOT finite-sample coverage or a distribution-free guarantee. Reject unsafe/nonfinite calculated sizes.
9. Exact test: 1..9 observations, enumerate all distinct permutations of the predicted multiset conditional on both marginals. Null and invalid retain distinct categories. No Monte Carlo. Greater counts k>=observed, less k<=observed, two-sided counts |k|>=|observed|, ties included. Since pe is fixed, comparison uses integer count numerators. p=extreme/permutations. The absolute-kappa two-sided tail differs from a doubled smaller one-sided tail. All-equal/all-abstain have p=1. Beyond 9 throws a named size limit (9! bounds enumeration). This tests conditional independence under exchangeability, not a confidence interval or evidence of predictive accuracy.

## Primary formula sources

- Cohen (1968), weighted kappa, DOI https://doi.org/10.1037/h0026256 ; primary record https://pubmed.ncbi.nlm.nih.gov/19673146/ .
- Fleiss, Cohen & Everitt (1969), large-sample standard errors, DOI https://doi.org/10.1037/h0028106 . The implementation explicitly derives the multinomial delta gradient above, rather than claiming a different finite-sample standard-error formula.
- Byrt, Bishop & Carlin (1993), bias, prevalence and kappa, primary record https://pubmed.ncbi.nlm.nih.gov/8501467/ ; DOI https://doi.org/10.1016/0895-4356(93)90018-V . Binary adjustment only.
- Krippendorff, Computing Alpha Reliability, author's university resource https://www.asc.upenn.edu/krippendorffs-alpha-reliability .
- Clopper & Pearson (1934), exact binomial interval, primary publisher https://academic.oup.com/biomet/article-abstract/26/4/404/291538 .
- Hemerik & Goeman (2018), Exact testing with random permutations, primary author manuscript https://arxiv.org/abs/1411.7565 . Full enumeration is the exact conditional permutation special case.
- The precision planner is a declared algebraic consequence of the delta-method variance above, not an independently validated sample-size theorem.

- statsmodels primary implementation of asymptotic kappa variance/CI: https://www.statsmodels.org/stable/_modules/statsmodels/stats/inter_rater.html .
- SciPy primary implementation documentation for pairings permutation tests: https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.permutation_test.html .
