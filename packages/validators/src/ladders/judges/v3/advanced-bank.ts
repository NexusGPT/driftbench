import {
  binaryLabellerPabak,
  exactLabellerKappaTest,
  type LabellerAnswer,
  type LabelSet,
  labellerConfusion,
  labellerCoverageCurve,
  labellerKappaInterval,
  labellerNominalAlpha,
  planLabellerKappaSample,
  scoreMappedLabeller,
  selectLabellerThreshold,
  weightedLabellerKappa,
} from '@agent-nexus/driftbench-judges';
import type { Tier } from '../../../ladder';
import { type LabellerBankItem, type LabellerFactory, labellerBank, runLabellerItem } from './bank';
import type { LabellerFamily } from './fixtures';

const set = (names: readonly string[]): LabelSet => ({
  name: 'fictional analysis categories',
  labels: names.map((name) => ({ name, description: `Fictional category ${name}.` })),
});
const binary = set(['a', 'b']);
const ternary = set(['a', 'b', 'c']);
const Z95 = 1.959963984540054;
const Z90 = 1.6448536269514722;
function equal(actual: unknown, expected: unknown, note: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${note}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}
function near(actual: number | null | undefined, expected: number, note: string, tolerance = 1e-7): void {
  if (typeof actual !== 'number' || !Number.isFinite(actual) || Math.abs(actual - expected) > tolerance)
    throw new Error(`${note}: got ${actual}, expected ${expected}`);
}
function rejects(call: () => unknown, note: string): void {
  try {
    call();
  } catch (error) {
    // A missing capability is not successful domain validation.
    if (error instanceof Error && /not implemented|stub|unavailable|not a function/i.test(error.message))
      throw error;
    return;
  }
  throw new Error(`${note}: invalid input was accepted`);
}
function observations(counts: readonly (readonly number[])[]): { gold: string[]; answers: string[] } {
  const gold: string[] = [];
  const answers: string[] = [];
  counts.forEach((row, i) => {
    row.forEach((n, j) => {
      for (let k = 0; k < n; k += 1) {
        gold.push(String.fromCharCode(97 + i));
        answers.push(String.fromCharCode(97 + j));
      }
    });
  });
  return { gold, answers };
}

/** Direct finite-difference delta reference: no production gradient or statistics helper. */
function delta(joint: readonly (readonly number[])[]) {
  const dimension = joint.length;
  const estimate = (cells: readonly (readonly number[])[]) => {
    const rows = cells.map((row) => row.reduce((a, b) => a + b, 0));
    const cols = Array.from({ length: dimension }, (_, j) =>
      cells.reduce((sum, row) => sum + (row[j] ?? 0), 0),
    );
    const observed = cells.reduce((sum, row, i) => sum + (row[i] ?? 0), 0);
    const chance = rows.reduce((sum, n, i) => sum + n * (cols[i] ?? 0), 0);
    return chance === 1 ? 1 : (observed - chance) / (1 - chance);
  };
  const gradients: number[][] = [];
  const h = 1e-6;
  for (let i = 0; i < dimension; i += 1) {
    const row: number[] = [];
    for (let j = 0; j < dimension; j += 1) {
      const plus = joint.map((r) => [...r]);
      const minus = joint.map((r) => [...r]);
      (plus[i] as number[])[j] = (plus[i]?.[j] ?? 0) + h;
      (minus[i] as number[])[j] = (minus[i]?.[j] ?? 0) - h;
      row.push((estimate(plus) - estimate(minus)) / (2 * h));
    }
    gradients.push(row);
  }
  let mean = 0;
  let square = 0;
  joint.forEach((row, i) => {
    row.forEach((p, j) => {
      const g = gradients[i]?.[j] ?? 0;
      mean += p * g;
      square += p * g * g;
    });
  });
  return { kappa: estimate(joint), variance: square - mean * mean };
}
function jointOf(gold: readonly string[], answers: readonly LabellerAnswer[], names: readonly string[]) {
  // Missing and invalid predictions use separate positions with zero gold marginal.
  const domain = [...names, 'none'];
  const n = domain.length + 2;
  const cells = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let i = 0; i < gold.length; i += 1) {
    const r = domain.indexOf(gold[i] as string);
    const answer = answers[i];
    const c =
      answer === null
        ? n - 2
        : typeof answer === 'string' && domain.includes(answer)
          ? domain.indexOf(answer)
          : n - 1;
    (cells[r] as number[])[c] = (cells[r]?.[c] ?? 0) + 1 / gold.length;
  }
  return cells;
}
function checkInterval(
  gold: string[],
  answers: LabellerAnswer[],
  confidence = 0.95,
  labelSet: LabelSet = binary,
) {
  const result = labellerKappaInterval(gold, answers, labelSet, confidence);
  if (confidence === 0.95)
    equal(labellerKappaInterval(gold, answers, labelSet), result, 'default confidence');
  const expected = delta(
    jointOf(
      gold,
      answers,
      labelSet.labels.map((label) => label.name),
    ),
  );
  const se = Math.sqrt(expected.variance / gold.length);
  const z = confidence === 0.9 ? Z90 : Z95;
  near(result.estimate, expected.kappa, 'kappa estimate');
  near(result.standardError, se, 'delta standard error');
  near(result.varianceFactor, expected.variance, 'multinomial variance factor');
  near(result.lower, Math.max(-1, expected.kappa - z * se), 'lower endpoint');
  near(result.upper, Math.min(1, expected.kappa + z * se), 'upper endpoint');
  equal(
    [result.total, result.confidence, result.method, result.status],
    [gold.length, confidence, 'multinomial-delta', 'estimated'],
    'interval metadata',
  );
}

/** Pairwise coincidence reference, including variable observed counts per rectangular unit. */
function alphaReference(ratings: readonly (readonly LabellerAnswer[])[]) {
  const units = ratings[0]?.length ?? 0;
  let pairable = 0;
  let missing = 0;
  let unpairableUnits = 0;
  let disagreement = 0;
  const counts = new Map<string, number>();
  for (let u = 0; u < units; u += 1) {
    const values = ratings.map((r) => r[u]).filter((v): v is string => v !== null && v !== undefined);
    missing += ratings.length - values.length;
    if (values.length < 2) {
      unpairableUnits += 1;
      continue;
    }
    pairable += values.length;
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    for (const a of values) for (const b of values) if (a !== b) disagreement += 1 / (values.length - 1);
  }
  if (!pairable)
    return {
      alpha: null,
      observed: null,
      expected: null,
      pairable,
      units,
      raters: ratings.length,
      missing,
      unpairableUnits,
      status: 'insufficient',
    };
  const observed = disagreement / pairable;
  const expected =
    (pairable * pairable - [...counts.values()].reduce((s, n) => s + n * n, 0)) / (pairable * (pairable - 1));
  return {
    alpha: expected === 0 ? 1 : 1 - observed / expected,
    observed,
    expected,
    pairable,
    units,
    raters: ratings.length,
    missing,
    unpairableUnits,
    status: 'estimated',
  };
}
function checkAlpha(ratings: readonly (readonly LabellerAnswer[])[]) {
  const actual = labellerNominalAlpha(ratings, ternary);
  const expected = alphaReference(ratings);
  for (const key of ['alpha', 'observed', 'expected'] as const) {
    if (expected[key] === null) equal(actual[key], null, `alpha ${key}`);
    else near(actual[key], expected[key] as number, `alpha ${key}`);
  }
  for (const key of ['pairable', 'units', 'raters', 'missing', 'unpairableUnits', 'status'] as const)
    equal(actual[key], expected[key], `alpha ${key}`);
}
function weightedReference(
  gold: readonly string[],
  answers: readonly string[],
  order: readonly string[],
  power: number,
) {
  const distance = (a: string, b: string) =>
    (Math.abs(order.indexOf(a) - order.indexOf(b)) / (order.length - 1)) ** power;
  let observedDisagreement = 0;
  let expectedDisagreement = 0;
  for (let i = 0; i < gold.length; i += 1)
    observedDisagreement += distance(gold[i] as string, answers[i] as string) / gold.length;
  for (const a of gold)
    for (const b of answers) expectedDisagreement += distance(a, b) / (gold.length * gold.length);
  return {
    kappa: expectedDisagreement === 0 ? 1 : 1 - observedDisagreement / expectedDisagreement,
    observed: 1 - observedDisagreement,
    expected: 1 - expectedDisagreement,
  };
}
function checkWeighted(order: string[], gold: string[], answers: string[], power: 1 | 2) {
  const got = weightedLabellerKappa(gold, answers, order, power === 1 ? 'linear' : 'quadratic');
  equal(got.n, gold.length, 'weighted paired sample size');
  if (power === 1) equal(weightedLabellerKappa(gold, answers, order), got, 'default linear weighting');
  const expected = weightedReference(gold, answers, order, power);
  for (const key of ['kappa', 'observed', 'expected'] as const)
    near(got[key], expected[key], `weighted ${key}`);
}

/** Enumerate index permutations, deduplicate outcome vectors, compare fixed-margin integer numerators. */
function exactReference(
  gold: string[],
  answers: LabellerAnswer[],
  alternative: 'greater' | 'less' | 'two-sided',
) {
  const labels = ['a', 'b', 'c', 'none'];
  // Integer categories avoid sentinel collisions: -1 is abstain; -2 is invalid.
  const categories = answers.map((answer) =>
    answer === null
      ? -1
      : typeof answer === 'string' && labels.includes(answer)
        ? labels.indexOf(answer)
        : -2,
  );
  const permutations = new Set<string>();
  const vectors: number[][] = [];
  const visit = (rest: number[], chosen: number[]) => {
    if (!rest.length) {
      const key = JSON.stringify(chosen);
      if (!permutations.has(key)) {
        permutations.add(key);
        vectors.push(chosen);
      }
      return;
    }
    rest.forEach((index, p) => {
      visit([...rest.slice(0, p), ...rest.slice(p + 1)], [...chosen, categories[index] as number]);
    });
  };
  visit(
    categories.map((_, i) => i),
    [],
  );
  const n = gold.length;
  const chanceNumerator = labels.reduce(
    (s, name, category) =>
      s + gold.filter((v) => v === name).length * categories.filter((v) => v === category).length,
    0,
  );
  const numerator = (values: number[]) =>
    n * values.filter((answer, i) => answer >= 0 && labels[answer] === gold[i]).length - chanceNumerator;
  const observed = numerator(categories);
  const extreme = vectors.filter((values) =>
    alternative === 'greater'
      ? numerator(values) >= observed
      : alternative === 'less'
        ? numerator(values) <= observed
        : Math.abs(numerator(values)) >= Math.abs(observed),
  ).length;
  return {
    kappa: n * n === chanceNumerator ? 1 : observed / (n * n - chanceNumerator),
    pValue: extreme / vectors.length,
    permutations: vectors.length,
    extreme,
    alternative,
    method: 'exact-fixed-margin-permutation',
  };
}
function checkExact(
  gold: string[],
  answers: LabellerAnswer[],
  alternative: 'greater' | 'less' | 'two-sided',
) {
  const actual = exactLabellerKappaTest(gold, answers, ternary, alternative);
  const expected = exactReference(gold, answers, alternative);
  near(actual.kappa, expected.kappa, 'exact kappa');
  near(actual.pValue, expected.pValue, 'exact probability');
  for (const key of ['permutations', 'extreme', 'alternative', 'method'] as const)
    equal(actual[key], expected[key], `exact ${key}`);
}

type CapabilityCase = { id: string; family: LabellerFamily; tier: Tier; cause: string; check: () => void };
const cases: CapabilityCase[] = [
  {
    id: 'ci-balanced-delta',
    family: 'agreement',
    tier: 3,
    cause: 'compute multinomial kappa delta variance including marginal coupling',
    check() {
      const x = observations([
        [40, 10],
        [10, 40],
      ]);
      checkInterval(x.gold, x.answers);
    },
  },
  {
    id: 'ci-unequal-marginals-confidence',
    family: 'agreement',
    tier: 4,
    cause: 'compute multinomial kappa delta variance including marginal coupling',
    check() {
      const x = observations([
        [30, 15],
        [5, 50],
      ]);
      checkInterval(x.gold, x.answers, 0.9);
      checkInterval(x.gold, x.answers, 0.95);
      const y = observations([
        [20, 5, 1],
        [2, 15, 4],
        [7, 1, 25],
      ]);
      checkInterval(y.gold, y.answers, 0.95, ternary);
      const balanced = observations([
        [40, 10],
        [10, 40],
      ]);
      const confidence = 1 - Number.EPSILON / 2;
      const extreme = labellerKappaInterval(balanced.gold, balanced.answers, binary, confidence);
      // Independently evaluated with Python NormalDist.inv_cdf(2**-54),
      // and cross-checked by bisection of math.erfc(z / sqrt(2)) / 2.
      const z = 8.292361075813595;
      const reference = delta([
        [0.4, 0.1],
        [0.1, 0.4],
      ]);
      near(
        extreme.lower,
        reference.kappa - z * Math.sqrt(reference.variance / 100),
        'extreme confidence finite lower',
      );
      near(extreme.upper, 1, 'extreme confidence clipped upper');
      equal(extreme.confidence, confidence, 'extreme confidence retained');
    },
  },
  {
    id: 'ci-missing-prediction-marginals',
    family: 'abstain',
    tier: 4,
    cause: 'retain missing and invalid prediction mass in kappa uncertainty',
    check() {
      checkInterval(['a', 'a', 'a', 'b', 'b', 'b'], ['a', null, '', 'a', 'b', null]);
    },
  },
  {
    id: 'ci-degenerate-no-false-certainty',
    family: 'agreement',
    tier: 3,
    cause: 'report degenerate kappa uncertainty as unavailable',
    check() {
      for (const [gold, answers] of [
        [['a'], ['a']],
        [
          ['a', 'b'],
          ['a', 'b'],
        ],
        [
          ['a', 'a'],
          ['a', 'a'],
        ],
      ] as [string[], string[]][]) {
        const r = labellerKappaInterval(gold, answers, binary);
        equal(
          [r.status, r.lower, r.upper, r.standardError, r.varianceFactor],
          ['degenerate', null, null, null, null],
          'degenerate interval',
        );
      }
    },
  },
  {
    id: 'pabak-skewed-prevalence',
    family: 'agreement',
    tier: 2,
    cause: 'apply binary prevalence adjustment to raw agreement',
    check() {
      const x = observations([
        [8, 1],
        [1, 0],
      ]);
      const r = binaryLabellerPabak(x.gold, x.answers, ['a', 'b']);
      equal(r.total, 10, 'binary total');
      near(r.agreement, 0.8, 'binary agreement');
      near(r.pabak, 0.6, 'PABAK');
    },
  },
  {
    id: 'pabak-complete-reversal',
    family: 'agreement',
    tier: 2,
    cause: 'preserve negative prevalence-adjusted agreement',
    check() {
      near(
        binaryLabellerPabak(['a', 'a', 'b', 'b'], ['b', 'b', 'a', 'a'], ['a', 'b']).pabak,
        -1,
        'negative PABAK',
      );
    },
  },
  {
    id: 'pabak-domain-and-abstention',
    family: 'abstain',
    tier: 3,
    cause: 'reject unsupported observations in binary adjustment',
    check() {
      rejects(() => binaryLabellerPabak(['a', 'b'], ['a', null], ['a', 'b']), 'binary abstention');
      rejects(() => binaryLabellerPabak(['a', 'c'], ['a', 'c'], ['a', 'b']), 'third category');
      near(binaryLabellerPabak(['a', 'a'], ['a', 'a'], ['a', 'b']).pabak, 1, 'single observed binary class');
    },
  },
  {
    id: 'weighted-linear-distance',
    family: 'agreement',
    tier: 3,
    cause: 'score explicit ordinal disagreement distances',
    check() {
      checkWeighted(['a', 'b', 'c'], ['a', 'a', 'b', 'c', 'c'], ['a', 'b', 'c', 'a', 'c'], 1);
    },
  },
  {
    id: 'weighted-quadratic-distance',
    family: 'agreement',
    tier: 4,
    cause: 'apply quadratic rather than linear ordinal distance',
    check() {
      checkWeighted(['a', 'b', 'c'], ['a', 'a', 'b', 'c', 'c'], ['a', 'b', 'c', 'a', 'c'], 2);
    },
  },
  {
    id: 'weighted-nonlexical-order',
    family: 'order-bias',
    tier: 4,
    cause: 'honor caller-specified ordinal positions',
    check() {
      checkWeighted(['c', 'a', 'b'], ['a', 'a', 'b', 'c', 'c'], ['a', 'b', 'c', 'a', 'c'], 1);
    },
  },
  {
    id: 'weighted-explicit-domain',
    family: 'none',
    tier: 3,
    cause: 'validate ordinal domain before weighted scoring',
    check() {
      rejects(() => weightedLabellerKappa(['a', 'none'], ['a', 'none'], ['a', 'b']), 'none needs a position');
      rejects(() => weightedLabellerKappa(['a', 'b'], ['a', null], ['a', 'b']), 'ordinal missing');
      rejects(() => weightedLabellerKappa(['a'], ['a'], ['a', 'a']), 'duplicate order');
      checkWeighted(['none', 'a', 'b'], ['none', 'a', 'b'], ['a', 'a', 'b'], 1);
    },
  },
  {
    id: 'alpha-complete-multiple-raters',
    family: 'agreement',
    tier: 4,
    cause: 'compute nominal coincidence agreement for multiple raters',
    check() {
      checkAlpha([
        ['a', 'a', 'b', 'c'],
        ['a', 'b', 'b', 'c'],
        ['b', 'a', 'b', 'c'],
      ]);
    },
  },
  {
    id: 'alpha-variable-observed-raters',
    family: 'abstain',
    tier: 5,
    cause: 'normalize nominal coincidences by each units observed rater count',
    check() {
      checkAlpha([
        ['a', 'a', 'b', null],
        ['a', null, 'c', 'a'],
        ['b', 'b', null, 'a'],
        [null, 'a', 'b', 'a'],
      ]);
    },
  },
  {
    id: 'alpha-singletons-not-marginals',
    family: 'abstain',
    tier: 5,
    cause: 'exclude unpairable units from alpha marginals',
    check() {
      checkAlpha([
        ['a', 'b', 'c'],
        ['b', 'b', null],
        [null, 'a', null],
      ]);
      checkAlpha([
        ['a', null],
        [null, 'b'],
      ]);
    },
  },
  {
    id: 'alpha-negative-and-invalid',
    family: 'near-miss',
    tier: 5,
    cause: 'preserve disagreement and reject invalid rater values',
    check() {
      checkAlpha([
        ['a', 'b'],
        ['b', 'a'],
      ]);
      rejects(
        () =>
          labellerNominalAlpha(
            [
              ['a', ''],
              ['a', ''],
            ],
            binary,
          ),
        'common invalid output',
      );
      rejects(() => labellerNominalAlpha([['a', 'b'], ['a']], binary), 'ragged ratings');
    },
  },
  {
    id: 'confusion-orientation',
    family: 'agreement',
    tier: 2,
    cause: 'orient confusion rows by gold and columns by predictions',
    check() {
      const r = labellerConfusion(['a', 'a', 'a', 'b'], ['a', 'b', 'b', 'b'], binary);
      equal(
        r.confusion.map((row) => row.slice(0, 2)).slice(0, 2),
        [
          [1, 2],
          [0, 1],
        ],
        'confusion orientation',
      );
      equal(
        r.predictionColumns.slice(0, 2),
        [
          { kind: 'label', label: 'a' },
          { kind: 'label', label: 'b' },
        ],
        'typed columns',
      );
    },
  },
  {
    id: 'confusion-rare-label-denominators',
    family: 'agreement',
    tier: 4,
    cause: 'compute class precision and recall with separate denominators',
    check() {
      const x = observations([
        [90, 9],
        [0, 1],
      ]);
      const r = labellerConfusion(x.gold, x.answers, binary).byLabel.find((v) => v.label === 'b');
      if (!r) throw new Error('rare label missing');
      equal([r.support, r.predicted, r.tp, r.fp, r.fn], [1, 10, 1, 9, 0], 'rare label counts');
      near(r.precision, 0.1, 'rare precision');
      near(r.recall, 1, 'rare recall');
      near(r.f1, 2 / 11, 'rare F1');
    },
  },
  {
    id: 'confusion-absent-class-undefined',
    family: 'agreement',
    tier: 3,
    cause: 'report undefined per-label ratios without invented perfect scores',
    check() {
      const r = labellerConfusion(['a', 'a'], ['a', 'a'], binary).byLabel.find((v) => v.label === 'b');
      if (!r) throw new Error('absent declared label missing');
      equal([r.support, r.predicted, r.precision, r.recall, r.f1], [0, 0, null, null, null], 'absent class');
    },
  },
  {
    id: 'confusion-none-abstain-invalid',
    family: 'none',
    tier: 4,
    cause: 'separate none, abstention and invalid prediction columns',
    check() {
      const r = labellerConfusion(['none', 'a', 'a', 'b'], ['none', null, '', 'a'], binary);
      equal(r.labels, ['a', 'b', 'none'], 'none row');
      equal(
        r.predictionColumns.slice(-2),
        [{ kind: 'abstain' }, { kind: 'invalid' }],
        'missing column types',
      );
      const a = r.byLabel.find((v) => v.label === 'a');
      if (!a) throw new Error('a missing');
      equal([a.tp, a.fp, a.fn], [0, 1, 2], 'missing creates FN only');
      equal([r.score.abstentions, r.score.invalid], [1, 1], 'missing counts');
    },
  },
];

const selective = [
  { gold: 'a', answer: 'a', confidence: 0.9 },
  { gold: 'b', answer: 'b', confidence: 0.8 },
  { gold: 'a', answer: 'b', confidence: 0.4 },
  { gold: 'b', answer: null, confidence: 1 },
  { gold: 'a', answer: '', confidence: 1 },
  { gold: 'none', answer: 'none', confidence: 0.8 },
];
const maps = () => ({
  goldSet: set(['old-a', 'old-b']),
  answerSet: set(['new-a', 'new-b']),
  targetSet: binary,
  goldMap: [
    { source: 'old-a', target: 'a' },
    { source: 'old-b', target: 'b' },
    { source: 'none', target: 'none' },
  ],
  answerMap: [
    { source: 'new-a', target: 'a' },
    { source: 'new-b', target: 'b' },
    { source: 'none', target: 'none' },
  ],
});
cases.push(
  {
    id: 'coverage-inclusive-and-selective-denominator',
    family: 'abstain',
    tier: 3,
    cause: 'accept only valid predictions at or above the confidence threshold',
    check() {
      const r = labellerCoverageCurve(selective, binary, [1, 0.8, 0, 0.8]);
      equal(
        r.map((p) => p.threshold),
        [0, 0.8, 1],
        'sorted unique thresholds',
      );
      const p = r[1];
      if (!p) throw new Error('threshold missing');
      equal(
        [p.total, p.accepted, p.correct, p.abstentions, p.invalid, p.belowThreshold],
        [6, 3, 3, 1, 1, 1],
        'selection counts',
      );
      near(p.coverage, 0.5, 'coverage retains rejected units');
      near(p.acceptedAccuracy, 1, 'accepted-only accuracy');
      const empty = r[2];
      if (!empty) throw new Error('empty threshold missing');
      equal(
        [empty.accepted, empty.acceptedAccuracy, empty.acceptedAccuracyInterval],
        [0, null, null],
        'empty selection',
      );
    },
  },
  {
    id: 'coverage-exact-binomial-boundaries',
    family: 'abstain',
    tier: 4,
    cause: 'report exact accepted-accuracy uncertainty at zero and full successes',
    check() {
      for (const correct of [true, false]) {
        const points = labellerCoverageCurve(
          Array.from({ length: 4 }, () => ({ gold: 'a', answer: correct ? 'a' : 'b', confidence: 1 })),
          binary,
          [0],
          0.95,
        );
        const interval = points[0]?.acceptedAccuracyInterval;
        if (!interval) throw new Error('accepted accuracy interval absent');
        near(interval.lower, correct ? 0.025 ** 0.25 : 0, 'exact lower');
        near(interval.upper, correct ? 1 : 1 - 0.025 ** 0.25, 'exact upper');
        near(interval.estimate, correct ? 1 : 0, 'interval estimate');
      }
      const interior = labellerCoverageCurve(
        [
          { gold: 'a', answer: 'a', confidence: 1 },
          { gold: 'b', answer: 'a', confidence: 1 },
        ],
        binary,
        [0],
      )[0]?.acceptedAccuracyInterval;
      if (!interior) throw new Error('interior binomial interval absent');
      near(interior.lower, 1 - Math.sqrt(0.975), 'interior exact lower');
      near(interior.upper, Math.sqrt(0.975), 'interior exact upper');
      near(interior.estimate, 0.5, 'interior estimate');
      const tiny = labellerCoverageCurve(
        [
          { gold: 'a', answer: 'a', confidence: 1 },
          { gold: 'b', answer: 'a', confidence: 1 },
        ],
        binary,
        [0],
        Number.MIN_VALUE,
      )[0]?.acceptedAccuracyInterval;
      if (!tiny) throw new Error('tiny-confidence binomial interval absent');
      near(tiny.lower, 1 - Math.sqrt(0.5), 'tiny-confidence exact lower');
      near(tiny.upper, Math.sqrt(0.5), 'tiny-confidence exact upper');
      near(tiny.estimate, 0.5, 'tiny-confidence estimate');
      const highConfidence = 1 - Number.EPSILON / 2;
      const high = labellerCoverageCurve(
        Array.from({ length: 4 }, () => ({ gold: 'a', answer: 'b', confidence: 1 })),
        binary,
        [0],
        highConfidence,
      )[0]?.acceptedAccuracyInterval;
      if (!high) throw new Error('high-confidence binomial interval absent');
      near(high.lower, 0, 'high-confidence zero-success lower');
      near(high.upper, 1 - ((1 - highConfidence) / 2) ** 0.25, 'high-confidence finite upper');
    },
  },
  {
    id: 'threshold-max-coverage-and-tie',
    family: 'abstain',
    tier: 4,
    cause: 'select greatest feasible coverage with lower-threshold tie break',
    check() {
      const options = { thresholds: [1, 0.8, 0.7, 0], minAccuracy: 0.9, minCoverage: 0.5 };
      const r = selectLabellerThreshold(selective, binary, options);
      equal(r?.threshold, 0.7, 'coverage tie selection');
      near(r?.coverage, 0.5, 'selected coverage');
      equal(
        selectLabellerThreshold(selective, binary, { ...options, minCoverage: 0.6 }),
        null,
        'infeasible coverage',
      );
      equal(
        selectLabellerThreshold(selective, binary, { thresholds: [1], minAccuracy: 0 }),
        null,
        'zero accepted cannot qualify',
      );
    },
  },
  {
    id: 'coverage-domain-validation',
    family: 'abstain',
    tier: 3,
    cause: 'reject invalid confidence and policy thresholds before selection',
    check() {
      rejects(
        () => labellerCoverageCurve([{ gold: 'a', answer: 'a', confidence: Number.NaN }], binary, [0]),
        'nonfinite confidence',
      );
      rejects(() => labellerCoverageCurve(selective, binary, [-0.1]), 'threshold outside range');
      rejects(() => labellerCoverageCurve(selective, binary, []), 'empty thresholds');
      rejects(
        () => selectLabellerThreshold(selective, binary, { thresholds: [0], minAccuracy: 1.1 }),
        'invalid accuracy target',
      );
      const p = labellerCoverageCurve(selective, binary, [0])[0];
      if (!p) throw new Error('valid coverage missing');
      near(p.acceptedAccuracy, 0.75, 'valid coverage control');
    },
  },
  {
    id: 'mapping-renamed-vocabularies',
    family: 'label-set-change',
    tier: 3,
    cause: 'map both label vocabularies explicitly into a common domain',
    check() {
      const r = scoreMappedLabeller(['old-a', 'old-b', 'none'], ['new-a', 'new-b', 'none'], maps());
      equal([r.correct, r.total, r.abstentions, r.invalid], [3, 3, 0, 0], 'renamed labels');
      near(r.kappa, 1, 'mapped agreement');
    },
  },
  {
    id: 'mapping-split-children-common-parent',
    family: 'label-set-change',
    tier: 4,
    cause: 'collapse split children only through explicit common-parent mapping',
    check() {
      const options = {
        goldSet: set(['parent', 'other']),
        answerSet: set(['child-1', 'child-2', 'other']),
        targetSet: binary,
        goldMap: [
          { source: 'parent', target: 'a' },
          { source: 'other', target: 'b' },
          { source: 'none', target: 'none' },
        ],
        answerMap: [
          { source: 'child-1', target: 'a' },
          { source: 'child-2', target: 'a' },
          { source: 'other', target: 'b' },
          { source: 'none', target: 'none' },
        ],
      };
      const r = scoreMappedLabeller(['parent', 'parent', 'other'], ['child-1', 'child-2', 'other'], options);
      equal(r.correct, 3, 'split collapse');
      near(r.kappa, 1, 'common-parent kappa');
    },
  },
  {
    id: 'mapping-total-and-unambiguous',
    family: 'label-set-change',
    tier: 4,
    cause: 'reject incomplete and ambiguous cross-version mappings',
    check() {
      const options = maps();
      rejects(
        () =>
          scoreMappedLabeller(['old-a'], ['new-a'], { ...options, answerMap: options.answerMap.slice(0, 2) }),
        'implicit none missing',
      );
      rejects(
        () =>
          scoreMappedLabeller(['old-a'], ['new-a'], {
            ...options,
            answerMap: [...options.answerMap, { source: 'new-a', target: 'b' }],
          }),
        'one-to-many split',
      );
      rejects(
        () =>
          scoreMappedLabeller(['old-a'], ['new-a'], {
            ...options,
            answerMap: [...options.answerMap, { source: 'new-a', target: 'a' }],
          }),
        'duplicate source',
      );
      equal(scoreMappedLabeller(['old-a'], ['new-a'], options).correct, 1, 'valid mapping control');
    },
  },
  {
    id: 'mapping-source-validity-before-target',
    family: 'label-set-change',
    tier: 5,
    cause: 'preserve invalid source answers and abstentions across mapping',
    check() {
      const r = scoreMappedLabeller(['old-a', 'old-b', 'old-a'], ['a', null, 'new-a'], maps());
      equal(
        [r.correct, r.invalid, r.abstentions, r.total],
        [1, 1, 1, 3],
        'target-name shortcut remains invalid',
      );
      near(r.agreement, 1 / 3, 'mapped raw agreement');
      rejects(() => scoreMappedLabeller(['a'], ['new-a'], maps()), 'gold must belong to source');
    },
  },
  {
    id: 'sample-plan-delta-margin',
    family: 'agreement',
    tier: 4,
    cause: 'plan kappa precision from the specified joint distribution',
    check() {
      const joint = [
        [0.4, 0.1],
        [0.1, 0.4],
      ];
      const reference = delta(joint);
      for (const margin of [0.1, 0.05]) {
        const r = planLabellerKappaSample(joint, { margin });
        equal(
          r.sampleSize,
          Math.max(2, Math.ceil((Z95 ** 2 * reference.variance) / margin ** 2)),
          'planned sample size',
        );
        near(r.kappa, reference.kappa, 'planned kappa');
        near(r.varianceFactor, reference.variance, 'planned variance');
        equal(
          [r.margin, r.confidence, r.method, r.assumption],
          [margin, 0.95, 'multinomial-delta', 'iid-fixed-joint'],
          'sample assumptions',
        );
      }
    },
  },
  {
    id: 'sample-plan-prevalence-and-confidence',
    family: 'agreement',
    tier: 5,
    cause: 'account for prevalence and confidence when planning kappa precision',
    check() {
      for (const joint of [
        [
          [0.7, 0.1],
          [0.05, 0.15],
        ],
        [
          [0.4, 0.1],
          [0.1, 0.4],
        ],
      ]) {
        const reference = delta(joint);
        const r = planLabellerKappaSample(joint, { margin: 0.08, confidence: 0.9 });
        equal(
          r.sampleSize,
          Math.max(2, Math.ceil((Z90 ** 2 * reference.variance) / 0.08 ** 2)),
          'prevalence-specific size',
        );
      }
    },
  },
  {
    id: 'sample-plan-reject-unidentified-designs',
    family: 'agreement',
    tier: 4,
    cause: 'reject invalid or degenerate kappa precision designs',
    check() {
      rejects(
        () =>
          planLabellerKappaSample(
            [
              [0.4, 0.1],
              [0.1, 0.3],
            ],
            { margin: 0.1 },
          ),
        'unnormalized joint',
      );
      rejects(
        () =>
          planLabellerKappaSample(
            [
              [0.5, 0],
              [0, 0.5],
            ],
            { margin: 0.1 },
          ),
        'zero delta variance',
      );
      rejects(
        () =>
          planLabellerKappaSample(
            [
              [0.4, 0.1],
              [0.1, 0.4],
            ],
            { margin: 0 },
          ),
        'zero margin',
      );
      equal(
        planLabellerKappaSample(
          [
            [0.4, 0.1],
            [0.1, 0.4],
          ],
          { margin: 0.1 },
        ).sampleSize,
        246,
        'valid sample-plan control',
      );
    },
  },
  {
    id: 'exact-fixed-margin-perfect',
    family: 'agreement',
    tier: 4,
    cause: 'enumerate distinct fixed-margin permutations exactly',
    check() {
      checkExact(['a', 'a', 'b', 'b'], ['a', 'a', 'b', 'b'], 'greater');
      near(
        exactLabellerKappaTest(['a', 'a', 'b', 'b'], ['a', 'a', 'b', 'b'], binary).pValue,
        1 / 3,
        'default absolute two-sided probability',
      );
    },
  },
  {
    id: 'exact-inclusive-ties-and-alternatives',
    family: 'agreement',
    tier: 5,
    cause: 'include tied permutations in the specified kappa tail',
    check() {
      for (const alternative of ['greater', 'less', 'two-sided'] as const)
        checkExact(['a', 'a', 'b', 'b'], ['a', 'b', 'a', 'b'], alternative);
      checkExact(['a', 'a', 'a', 'b', 'b'], ['a', 'b', 'b', 'a', 'a'], 'two-sided');
    },
  },
  {
    id: 'exact-missing-and-invalid-multisets',
    family: 'abstain',
    tier: 5,
    cause: 'retain distinct missing prediction classes in exact permutations',
    check() {
      checkExact(['a', 'a', 'b'], [null, null, 'a'], 'two-sided');
      checkExact(['a', 'a', 'b'], ['', '?', 'a'], 'two-sided');
      checkExact(['a', 'a', 'b', 'b'], [null, '', 'a', 'b'], 'greater');
      checkExact(['a', 'b', 'c'], [null, null, null], 'two-sided');
    },
  },
  {
    id: 'exact-degenerate-and-size-bound',
    family: 'agreement',
    tier: 5,
    cause: 'bound exact enumeration and handle constant observations without fabricated evidence',
    check() {
      checkExact(['a', 'a', 'a'], ['a', 'a', 'a'], 'two-sided');
      rejects(
        () => exactLabellerKappaTest(Array<string>(10).fill('a'), Array<string>(10).fill('a'), binary),
        'exact enumeration size',
      );
      rejects(() => exactLabellerKappaTest(['a', 'b'], ['a'], binary), 'unequal paired arrays');
    },
  },
);

/** Advanced math never borrows the candidate's output as its own expected answer. */
export function advancedLabellerBank(): LabellerBankItem[] {
  const anchors = labellerBank();
  return cases.map((capability, index) => {
    const anchor = anchors.find(
      (item) =>
        item.family === capability.family && item.tier === capability.tier && item.variant === index % 6,
    );
    if (!anchor) throw new Error(`missing classification anchor for ${capability.id}`);
    return {
      ...anchor,
      id: `labeller/advanced/${capability.id}`,
      cause: capability.cause,
      component: 'packages/judges/src/labeller-analysis.ts',
      async run(seed: number, factory?: LabellerFactory) {
        const classification = await runLabellerItem(anchor, seed, factory);
        let mathFailure: string | undefined;
        try {
          capability.check();
        } catch (error) {
          mathFailure = error instanceof Error ? error.message : String(error);
        }
        return {
          pass: classification.pass && mathFailure === undefined,
          detail: `${classification.detail}; advanced=${mathFailure ?? 'pass'}`,
          ...(classification.metrics ? { metrics: classification.metrics } : {}),
        };
      },
    };
  });
}
