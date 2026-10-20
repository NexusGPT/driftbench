/** Advanced labeller agreement analysis. Statistical methods and limitations are documented per API. */

import {
  betaQuantile,
  clopperPearson,
  cohenKappa,
  type Interval,
  type KappaResult,
  krippendorffAlpha,
  normalQuantile,
  zFor,
} from '@agent-nexus/driftbench-stats';
import {
  type LabellerAnswer,
  type LabellerScore,
  type LabelSet,
  labelSetHash,
  scoreLabeller,
} from './labeller';

export interface LabellerKappaInterval {
  estimate: number;
  lower: number | null;
  upper: number | null;
  standardError: number | null;
  varianceFactor: number | null;
  confidence: number;
  total: number;
  status: 'estimated' | 'degenerate';
  method: 'multinomial-delta';
}
export interface LabellerAlphaResult {
  alpha: number | null;
  observed: number | null;
  expected: number | null;
  pairable: number;
  units: number;
  raters: number;
  missing: number;
  unpairableUnits: number;
  status: 'estimated' | 'insufficient';
}
export type LabellerPredictionColumn =
  | { kind: 'label'; label: string }
  | { kind: 'abstain' }
  | { kind: 'invalid' };
export interface LabellerClassMetrics {
  label: string;
  support: number;
  predicted: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}
export interface LabellerConfusion {
  score: LabellerScore;
  labels: readonly string[];
  predictionColumns: readonly LabellerPredictionColumn[];
  confusion: readonly (readonly number[])[];
  byLabel: readonly LabellerClassMetrics[];
}
export interface ScoredLabellerObservation {
  gold: string;
  answer: LabellerAnswer;
  confidence: number;
}
export interface LabellerCoveragePoint {
  threshold: number;
  total: number;
  accepted: number;
  correct: number;
  coverage: number;
  acceptedAccuracy: number | null;
  acceptedAccuracyInterval: Interval | null;
  abstentions: number;
  invalid: number;
  belowThreshold: number;
}
export interface LabellerThresholdOptions {
  thresholds: readonly number[];
  minAccuracy: number;
  minCoverage?: number;
  confidence?: number;
}
export interface LabellerLabelMapping {
  source: string;
  target: string;
}
export interface LabellerMappingOptions {
  goldSet: LabelSet;
  answerSet: LabelSet;
  targetSet: LabelSet;
  goldMap: readonly LabellerLabelMapping[];
  answerMap: readonly LabellerLabelMapping[];
}
export interface LabellerSamplePlan {
  sampleSize: number;
  kappa: number;
  varianceFactor: number;
  confidence: number;
  margin: number;
  method: 'multinomial-delta';
  assumption: 'iid-fixed-joint';
}
export interface LabellerExactTest {
  kappa: number;
  pValue: number;
  permutations: number;
  extreme: number;
  alternative: 'greater' | 'less' | 'two-sided';
  method: 'exact-fixed-margin-permutation';
}

function probability(value: number, name: string, open = false): void {
  if (!Number.isFinite(value) || (open ? value <= 0 || value >= 1 : value < 0 || value > 1)) {
    throw new RangeError(`${name} must be finite and ${open ? 'strictly ' : ''}between 0 and 1`);
  }
}

function confidenceZ(confidence: number): number {
  probability(confidence, 'confidence', true);
  // An extremely small representable confidence can round its complement to one.
  const alpha = 1 - confidence;
  if (alpha === 1) return 0;
  const z = zFor(alpha);
  // Normal symmetry avoids rounding the upper-tail probability to one.
  return Number.isFinite(z) ? z : -normalQuantile(alpha / 2);
}

function confidenceBinomialInterval(correct: number, accepted: number, confidence: number): Interval {
  const alpha = 1 - confidence;
  if (alpha < 1 && 1 - alpha / 2 < 1) return clopperPearson(correct, accepted, alpha);
  // Preserve the same Clopper–Pearson inversion when complements round to endpoints.
  // Beta(a,b) symmetry evaluates its upper quantile through the lower tail of Beta(b,a).
  return {
    estimate: correct / accepted,
    lower: correct === 0 ? 0 : betaQuantile(alpha / 2, correct, accepted - correct + 1),
    upper: correct === accepted ? 1 : 1 - betaQuantile(alpha / 2, accepted - correct, correct + 1),
  };
}

function classNames(labelSet: LabelSet): string[] {
  labelSetHash(labelSet);
  return [...new Set([...labelSet.labels.map((label) => label.name), 'none'])];
}

function explicitCategories(categories: readonly string[], count?: number): Set<string> {
  if (
    !Array.isArray(categories) ||
    categories.length < 2 ||
    (count !== undefined && categories.length !== count)
  ) {
    throw new RangeError(
      count === undefined
        ? 'at least two ordered labels are required'
        : `exactly ${count} categories are required`,
    );
  }
  const names = new Set<string>();
  for (const label of categories) {
    if (typeof label !== 'string' || label.trim().length === 0 || names.has(label)) {
      throw new TypeError('categories must be distinct nonblank strings');
    }
    names.add(label);
  }
  return names;
}

function strictPairs(
  gold: readonly string[],
  answers: readonly LabellerAnswer[],
  names: Set<string>,
): string[] {
  if (
    !Array.isArray(gold) ||
    !Array.isArray(answers) ||
    gold.length === 0 ||
    gold.length !== answers.length
  ) {
    throw new RangeError('gold and answers must have the same nonzero length');
  }
  const accepted: string[] = [];
  for (let i = 0; i < gold.length; i++) {
    const expected = gold[i],
      answer = answers[i];
    if (
      typeof expected !== 'string' ||
      !names.has(expected) ||
      typeof answer !== 'string' ||
      !names.has(answer)
    ) {
      throw new TypeError(`observation ${i} is outside the explicit category domain`);
    }
    accepted.push(answer);
  }
  return accepted;
}

function encoded(gold: readonly string[], answers: readonly LabellerAnswer[], labelSet: LabelSet) {
  const score = scoreLabeller(gold, answers, labelSet);
  const labels = classNames(labelSet);
  const index = new Map(labels.map((label, i) => [label, i]));
  const actual = gold.map((label) => index.get(label) as number);
  const predicted = Array.from(answers, (answer) =>
    answer === null
      ? labels.length
      : typeof answer === 'string'
        ? (index.get(answer) ?? labels.length + 1)
        : labels.length + 1,
  );
  return { score, labels, actual, predicted };
}

/** Cell probabilities, nominal kappa and its multinomial delta variance factor n*Var(kappa). */
function deltaMoments(joint: readonly (readonly number[])[]) {
  const size = joint.length;
  const rows = new Array<number>(size).fill(0),
    columns = new Array<number>(size).fill(0);
  let observed = 0;
  for (let i = 0; i < size; i++)
    for (let j = 0; j < size; j++) {
      const p = joint[i]?.[j] as number;
      rows[i] = (rows[i] as number) + p;
      columns[j] = (columns[j] as number) + p;
      if (i === j) observed += p;
    }
  const expected = rows.reduce((sum, row, i) => sum + row * (columns[i] as number), 0);
  const denominator = 1 - expected;
  if (denominator <= 0) return { kappa: observed === 1 ? 1 : 0, varianceFactor: null };
  let meanGradient = 0,
    secondMoment = 0;
  for (let i = 0; i < size; i++)
    for (let j = 0; j < size; j++) {
      const gradient =
        (i === j ? 1 / denominator : 0) +
        ((observed - 1) * ((columns[i] as number) + (rows[j] as number))) / denominator ** 2;
      const p = joint[i]?.[j] as number;
      meanGradient += p * gradient;
      secondMoment += p * gradient * gradient;
    }
  return {
    kappa: (observed - expected) / denominator,
    varianceFactor: Math.max(0, secondMoment - meanGradient * meanGradient),
  };
}

/**
 * Asymptotic multinomial delta-method interval on nominal kappa, with iid units.
 * Cell gradient: I(i=j)/(1-pe) + (po-1)(col_i+row_j)/(1-pe)^2.
 * This is not a binomial interval on agreement. Zero-variance/undefined estimates return
 * null uncertainty rather than a misleading zero-width confidence claim.
 * Primary implementation reference: https://www.statsmodels.org/stable/_modules/statsmodels/stats/inter_rater.html
 */
export function labellerKappaInterval(
  gold: readonly string[],
  answers: readonly LabellerAnswer[],
  labelSet: LabelSet,
  confidence = 0.95,
): LabellerKappaInterval {
  const z = confidenceZ(confidence);
  const { score, labels, actual, predicted } = encoded(gold, answers, labelSet);
  const joint = Array.from({ length: labels.length + 2 }, () => new Array<number>(labels.length + 2).fill(0));
  for (let i = 0; i < actual.length; i++) {
    const row = joint[actual[i] as number] as number[],
      column = predicted[i] as number;
    row[column] = (row[column] as number) + 1;
  }
  for (const row of joint) for (let j = 0; j < row.length; j++) row[j] = (row[j] as number) / score.total;
  const { varianceFactor } = deltaMoments(joint);
  if (score.total < 2 || varianceFactor === null || varianceFactor <= 1e-15) {
    return {
      estimate: score.kappa,
      lower: null,
      upper: null,
      standardError: null,
      varianceFactor: null,
      confidence,
      total: score.total,
      status: 'degenerate',
      method: 'multinomial-delta',
    };
  }
  const standardError = Math.sqrt(varianceFactor / score.total);
  return {
    estimate: score.kappa,
    lower: Math.max(-1, score.kappa - z * standardError),
    upper: Math.min(1, score.kappa + z * standardError),
    standardError,
    varianceFactor,
    confidence,
    total: score.total,
    status: 'estimated',
    method: 'multinomial-delta',
  };
}

/** Binary-only PABAK: 2*po-1. Missing, invalid and a third category are unsupported.
 * Byrt, Bishop & Carlin (1993): https://pubmed.ncbi.nlm.nih.gov/8501467/
 */
export function binaryLabellerPabak(
  gold: readonly string[],
  answers: readonly LabellerAnswer[],
  categories: readonly [string, string],
): { total: number; agreement: number; pabak: number } {
  const valid = strictPairs(gold, answers, explicitCategories(categories, 2));
  const agreement = valid.filter((answer, i) => answer === gold[i]).length / gold.length;
  return { total: gold.length, agreement, pabak: 2 * agreement - 1 };
}

/** Ordered nominal classes with normalized linear/quadratic disagreement, without missing data.
 * Cohen (1968): https://doi.org/10.1037/h0026256
 */
export function weightedLabellerKappa(
  gold: readonly string[],
  answers: readonly LabellerAnswer[],
  orderedLabels: readonly string[],
  weights: 'linear' | 'quadratic' = 'linear',
): KappaResult {
  if (weights !== 'linear' && weights !== 'quadratic')
    throw new RangeError('weights must be linear or quadratic');
  const valid = strictPairs(gold, answers, explicitCategories(orderedLabels));
  const result = cohenKappa(gold, valid, { weights, categories: orderedLabels });
  const maximumDistance = (orderedLabels.length - 1) ** (weights === 'linear' ? 1 : 2);
  return {
    ...result,
    observed: Math.max(0, Math.min(1, 1 - (1 - result.observed) / maximumDistance)),
    expected: Math.max(0, Math.min(1, 1 - (1 - result.expected) / maximumDistance)),
  };
}

/** Nominal alpha on a rectangular raters-by-units matrix. Null is missing, never a class.
 * observed/expected are disagreement Do/De; pairable counts retained ratings, not units.
 * Author's derivation: https://www.asc.upenn.edu/krippendorffs-alpha-reliability
 */
export function labellerNominalAlpha(
  ratings: readonly (readonly LabellerAnswer[])[],
  labelSet: LabelSet,
): LabellerAlphaResult {
  const names = new Set(classNames(labelSet));
  if (
    !Array.isArray(ratings) ||
    ratings.length < 2 ||
    !Array.isArray(ratings[0]) ||
    ratings[0].length === 0
  ) {
    throw new RangeError('alpha requires at least two raters and one unit');
  }
  const units = ratings[0].length;
  const retained = new Array<number>(units).fill(0);
  let missing = 0;
  for (const row of ratings) {
    if (!Array.isArray(row) || row.length !== units)
      throw new RangeError('alpha ratings must be rectangular');
    for (let i = 0; i < units; i++) {
      const answer = row[i];
      if (answer === null) missing++;
      else {
        if (typeof answer !== 'string' || !names.has(answer)) throw new TypeError('invalid alpha rating');
        retained[i] = (retained[i] as number) + 1;
      }
    }
  }
  const unpairableUnits = retained.filter((count) => count < 2).length;
  const common = { units, raters: ratings.length, missing, unpairableUnits };
  if (unpairableUnits === units)
    return { ...common, alpha: null, observed: null, expected: null, pairable: 0, status: 'insufficient' };
  return { ...common, ...krippendorffAlpha(ratings, { level: 'nominal' }), status: 'estimated' };
}

/** Per-label counts keep abstentions/invalid predictions as separate typed columns. */
export function labellerConfusion(
  gold: readonly string[],
  answers: readonly LabellerAnswer[],
  labelSet: LabelSet,
): LabellerConfusion {
  const { score, labels, actual, predicted } = encoded(gold, answers, labelSet);
  const confusion = labels.map(() => new Array<number>(labels.length + 2).fill(0));
  for (let i = 0; i < actual.length; i++) {
    const row = confusion[actual[i] as number] as number[],
      column = predicted[i] as number;
    row[column] = (row[column] as number) + 1;
  }
  const byLabel = labels.map((label, i) => {
    const row = confusion[i] as number[];
    const support = row.reduce((sum, count) => sum + count, 0);
    const predicted = confusion.reduce((sum, row) => sum + (row[i] as number), 0);
    const tp = row[i] as number,
      fp = predicted - tp,
      fn = support - tp;
    return {
      label,
      support,
      predicted,
      tp,
      fp,
      fn,
      precision: predicted === 0 ? null : tp / predicted,
      recall: support === 0 ? null : tp / support,
      f1: 2 * tp + fp + fn === 0 ? null : (2 * tp) / (2 * tp + fp + fn),
    };
  });
  const predictionColumns: LabellerPredictionColumn[] = labels.map((label) => ({ kind: 'label', label }));
  predictionColumns.push({ kind: 'abstain' }, { kind: 'invalid' });
  return { score, labels, predictionColumns, confusion, byLabel };
}

/**
 * Empirical selective accuracy versus coverage. Accepts valid answers with confidence >= threshold.
 * Accepted-accuracy intervals are exact Clopper-Pearson binomial intervals for a fixed threshold;
 * they are not simultaneous intervals or post-selection guarantees.
 * https://academic.oup.com/biomet/article-abstract/26/4/404/291538
 */
export function labellerCoverageCurve(
  observations: readonly ScoredLabellerObservation[],
  labelSet: LabelSet,
  thresholds: readonly number[],
  confidence = 0.95,
): LabellerCoveragePoint[] {
  confidenceZ(confidence);
  if (!Array.isArray(observations) || observations.length === 0)
    throw new RangeError('observations must be nonempty');
  if (!Array.isArray(thresholds) || thresholds.length === 0)
    throw new RangeError('thresholds must be nonempty');
  for (const threshold of thresholds) probability(threshold, 'threshold');
  for (const observation of observations) probability(observation.confidence, 'observation confidence');
  const gold = observations.map((observation) => observation.gold),
    answers = observations.map((observation) => observation.answer);
  const { score, labels, actual, predicted } = encoded(gold, answers, labelSet);
  return [...new Set(thresholds)]
    .sort((a, b) => a - b)
    .map((threshold) => {
      let accepted = 0,
        correct = 0;
      for (let i = 0; i < observations.length; i++) {
        if (
          (predicted[i] as number) < labels.length &&
          (observations[i] as ScoredLabellerObservation).confidence >= threshold
        ) {
          accepted++;
          if (predicted[i] === actual[i]) correct++;
        }
      }
      return {
        threshold,
        total: score.total,
        accepted,
        correct,
        coverage: accepted / score.total,
        acceptedAccuracy: accepted === 0 ? null : correct / accepted,
        acceptedAccuracyInterval:
          accepted === 0 ? null : confidenceBinomialInterval(correct, accepted, confidence),
        abstentions: score.abstentions,
        invalid: score.invalid,
        belowThreshold: score.total - score.abstentions - score.invalid - accepted,
      };
    });
}

/** Selects an empirical operating point; held-out validation is required for deployment claims. */
export function selectLabellerThreshold(
  observations: readonly ScoredLabellerObservation[],
  labelSet: LabelSet,
  options: LabellerThresholdOptions,
): LabellerCoveragePoint | null {
  const { minAccuracy, minCoverage = 0, confidence = 0.95 } = options;
  probability(minAccuracy, 'minimum accuracy');
  probability(minCoverage, 'minimum coverage');
  const curve = labellerCoverageCurve(observations, labelSet, options.thresholds, confidence);
  let selected: LabellerCoveragePoint | null = null;
  for (const point of curve) {
    if (
      point.acceptedAccuracy !== null &&
      point.acceptedAccuracy >= minAccuracy &&
      point.coverage >= minCoverage &&
      (!selected || point.coverage > selected.coverage)
    )
      selected = point;
  }
  return selected;
}

function completeMapping(
  source: LabelSet,
  target: Set<string>,
  entries: readonly LabellerLabelMapping[],
): Map<string, string> {
  const sources = new Set(classNames(source));
  if (!Array.isArray(entries)) throw new TypeError('mapping must be an array');
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (!sources.has(entry.source) || !target.has(entry.target) || map.has(entry.source)) {
      throw new TypeError('mapping contains an unknown or duplicate source/target');
    }
    map.set(entry.source, entry.target);
  }
  if (map.size !== sources.size) throw new TypeError('mapping must cover every source label including none');
  return map;
}

/** Renames and split-child collapse require explicit total maps to a shared ontology. */
export function scoreMappedLabeller(
  gold: readonly string[],
  answers: readonly LabellerAnswer[],
  options: LabellerMappingOptions,
): LabellerScore {
  // Validate original gold and lengths before any mapping can hide an invalid observation.
  scoreLabeller(gold, answers, options.goldSet);
  const target = new Set(classNames(options.targetSet));
  const goldMap = completeMapping(options.goldSet, target, options.goldMap);
  const answerMap = completeMapping(options.answerSet, target, options.answerMap);
  const mappedGold = gold.map((label) => goldMap.get(label) as string);
  // The empty string cannot be a declared target label. Unknown source answers must remain
  // invalid even when their text happens to name a valid target category.
  const mappedAnswers = Array.from(answers, (answer) =>
    answer === null ? null : typeof answer === 'string' ? (answerMap.get(answer) ?? '') : '',
  );
  return scoreLabeller(mappedGold, mappedAnswers, options.targetSet);
}

/**
 * Assumed iid precision plan, n=ceil(z²*V/margin²), under a supplied joint distribution.
 * V is the same multinomial delta variance factor as labellerKappaInterval.
 * This is asymptotic assumed precision, not guaranteed finite-sample coverage.
 */
export function planLabellerKappaSample(
  joint: readonly (readonly number[])[],
  options: { margin: number; confidence?: number },
): LabellerSamplePlan {
  const { margin, confidence = 0.95 } = options;
  probability(margin, 'margin', true);
  const z = confidenceZ(confidence);
  if (!Array.isArray(joint) || joint.length < 2)
    throw new RangeError('joint distribution must be square with at least two categories');
  let mass = 0;
  for (const row of joint) {
    if (!Array.isArray(row) || row.length !== joint.length)
      throw new RangeError('joint distribution must be square');
    for (const p of row) {
      probability(p, 'joint probability');
      mass += p;
    }
  }
  if (Math.abs(mass - 1) > 1e-10) throw new RangeError('joint probabilities must sum to one');
  const { kappa, varianceFactor } = deltaMoments(joint);
  if (varianceFactor === null || varianceFactor <= 1e-15)
    throw new RangeError('degenerate joint distribution cannot support a precision plan');
  const sampleSize = Math.max(2, Math.ceil((z * z * varianceFactor) / (margin * margin)));
  if (!Number.isSafeInteger(sampleSize))
    throw new RangeError('planned sample size exceeds safe integer range');
  return {
    sampleSize,
    kappa,
    varianceFactor,
    confidence,
    margin,
    method: 'multinomial-delta',
    assumption: 'iid-fixed-joint',
  };
}

/**
 * Exact conditional association test, enumerating every distinct predicted multiset permutation.
 * At most nine units (9! enumerations). Both marginals fixed; exchangeability required.
 * Two-sided means the inclusive absolute-kappa tail, not twice the smaller one-sided tail.
 * Primary methodology: https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.permutation_test.html
 */
export function exactLabellerKappaTest(
  gold: readonly string[],
  answers: readonly LabellerAnswer[],
  labelSet: LabelSet,
  alternative: 'greater' | 'less' | 'two-sided' = 'two-sided',
): LabellerExactTest {
  if (!['greater', 'less', 'two-sided'].includes(alternative))
    throw new RangeError('unknown exact-test alternative');
  const { score, actual, predicted } = encoded(gold, answers, labelSet);
  if (score.total > 9) throw new RangeError('exact kappa permutation test supports at most 9 observations');
  const counts = new Map<number, number>(),
    goldCounts = new Map<number, number>();
  for (const label of actual) goldCounts.set(label, (goldCounts.get(label) ?? 0) + 1);
  for (const label of predicted) counts.set(label, (counts.get(label) ?? 0) + 1);
  let chanceCount = 0;
  for (const [label, count] of goldCounts) chanceCount += count * (counts.get(label) ?? 0);
  const observedNumerator = score.correct * score.total - chanceCount;
  let permutations = 0,
    extreme = 0;
  const categories = [...counts.keys()];
  const visit = (index: number, correct: number): void => {
    if (index === score.total) {
      permutations++;
      // Fixed denominator: integer numerators compare ties exactly, without floating tolerances.
      const numerator = correct * score.total - chanceCount;
      if (
        alternative === 'greater'
          ? numerator >= observedNumerator
          : alternative === 'less'
            ? numerator <= observedNumerator
            : Math.abs(numerator) >= Math.abs(observedNumerator)
      )
        extreme++;
      return;
    }
    for (const category of categories) {
      const count = counts.get(category) as number;
      if (count === 0) continue;
      counts.set(category, count - 1);
      visit(index + 1, correct + (category === actual[index] ? 1 : 0));
      counts.set(category, count);
    }
  };
  visit(0, 0);
  return {
    kappa: score.kappa,
    pValue: extreme / permutations,
    permutations,
    extreme,
    alternative,
    method: 'exact-fixed-margin-permutation',
  };
}
