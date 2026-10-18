import { describe, expect, it } from 'vitest';
import type { LabelSet } from '../src/labeller';
import {
  binaryLabellerPabak,
  exactLabellerKappaTest,
  type LabellerMappingOptions,
  labellerConfusion,
  labellerCoverageCurve,
  labellerKappaInterval,
  labellerNominalAlpha,
  planLabellerKappaSample,
  type ScoredLabellerObservation,
  scoreMappedLabeller,
  selectLabellerThreshold,
  weightedLabellerKappa,
} from '../src/labeller-analysis';

const set = (...names: string[]): LabelSet => ({
  name: 'fictional seals',
  labels: names.map((name) => ({ name, description: `Fictional ${name} seal.` })),
});
const labels = set('amber', 'azure');
const balancedGold = [...Array<string>(50).fill('amber'), ...Array<string>(50).fill('azure')];
const balancedAnswers = [
  ...Array<string>(40).fill('amber'),
  ...Array<string>(20).fill('azure'),
  ...Array<string>(10).fill('amber'),
  ...Array<string>(30).fill('azure'),
];

describe('kappa uncertainty and sample planning', () => {
  it('keeps the normal quantile finite at the largest supported confidence', () => {
    const confidence = 1 - Number.EPSILON / 2;
    const interval = labellerKappaInterval(balancedGold, balancedAnswers, labels, confidence);
    expect(interval.lower).toBeCloseTo(-0.06338888606508764, 12);
    const planned = planLabellerKappaSample(
      [
        [0.4, 0.1],
        [0.1, 0.4],
      ],
      { margin: 0.1, confidence },
    );
    expect(planned.sampleSize).toBeGreaterThan(4000);
    expect(planned.sampleSize).toBeLessThan(5000);
  });
  it('uses the multinomial kappa variance rather than a raw agreement interval', () => {
    const result = labellerKappaInterval(balancedGold, balancedAnswers, labels);
    expect(result.estimate).toBeCloseTo(0.6, 12);
    expect(result.varianceFactor).toBeCloseTo(0.64, 12);
    expect(result.standardError).toBeCloseTo(0.08, 12);
    expect(result.lower).toBeCloseTo(0.4432028812367957, 10);
    expect(result.upper).toBeCloseTo(0.7567971187632043, 10);
    expect(result).toMatchObject({
      confidence: 0.95,
      total: 100,
      status: 'estimated',
      method: 'multinomial-delta',
    });
  });

  it('shrinks at sqrt(n), widens with confidence and flags degenerate uncertainty', () => {
    const base = labellerKappaInterval(balancedGold, balancedAnswers, labels);
    const twice = labellerKappaInterval(
      [...balancedGold, ...balancedGold],
      [...balancedAnswers, ...balancedAnswers],
      labels,
    );
    expect(twice.standardError).toBeCloseTo((base.standardError as number) / Math.sqrt(2), 12);
    expect(labellerKappaInterval(balancedGold, balancedAnswers, labels, 0.99).lower).toBeLessThan(
      base.lower as number,
    );
    expect(labellerKappaInterval(['amber', 'azure'], ['amber', 'azure'], labels)).toMatchObject({
      estimate: 1,
      lower: null,
      upper: null,
      status: 'degenerate',
    });
    expect(labellerKappaInterval(['amber'], [null], labels)).toMatchObject({
      estimate: 0,
      standardError: null,
      status: 'degenerate',
    });
    expect(() => labellerKappaInterval(['amber'], ['amber'], labels, 1)).toThrow();
  });

  it('plans assumed iid precision from the same joint variance', () => {
    const joint = [
      [0.4, 0.1],
      [0.1, 0.4],
    ];
    expect(planLabellerKappaSample(joint, { margin: 0.1 })).toMatchObject({
      sampleSize: 246,
      confidence: 0.95,
      margin: 0.1,
      method: 'multinomial-delta',
      assumption: 'iid-fixed-joint',
    });
    expect(planLabellerKappaSample(joint, { margin: 0.1 }).kappa).toBeCloseTo(0.6, 12);
    expect(planLabellerKappaSample(joint, { margin: 0.1 }).varianceFactor).toBeCloseTo(0.64, 12);
    expect(planLabellerKappaSample(joint, { margin: 0.05 }).sampleSize).toBe(984);
    for (const invalid of [
      [
        [1, 0],
        [0, 0],
      ],
      [
        [0.2, 0.1],
        [0.1, 0.2],
      ],
      [
        [NaN, 0],
        [0, 1],
      ],
      [[1]],
      [[0.5, 0.5]],
    ]) {
      expect(() => planLabellerKappaSample(invalid, { margin: 0.1 })).toThrow();
    }
    expect(() => planLabellerKappaSample(joint, { margin: 0 })).toThrow();
  });
});

describe('binary and ordinal agreement', () => {
  it('computes binary PABAK only for a declared complete binary domain', () => {
    expect(
      binaryLabellerPabak(
        ['amber', 'amber', 'amber', 'azure'],
        ['amber', 'amber', 'azure', 'azure'],
        ['amber', 'azure'],
      ),
    ).toEqual({ total: 4, agreement: 0.75, pabak: 0.5 });
    expect(binaryLabellerPabak(['none'], ['none'], ['amber', 'none']).pabak).toBe(1);
    expect(() => binaryLabellerPabak(['amber'], [null], ['amber', 'azure'])).toThrow();
    expect(() => binaryLabellerPabak(['none'], ['none'], ['amber', 'azure'])).toThrow();
    expect(() =>
      binaryLabellerPabak(['amber'], ['amber'], ['amber', 'azure', 'violet'] as unknown as [string, string]),
    ).toThrow();
  });

  it('weights ordinal near misses and normalizes reported agreement to [0,1]', () => {
    const gold = ['low', 'low', 'high', 'high'],
      answers = ['low', 'middle', 'middle', 'high'];
    expect(weightedLabellerKappa(gold, answers, ['low', 'middle', 'high'], 'linear')).toMatchObject({
      kappa: 0.5,
      observed: 0.75,
      expected: 0.5,
      n: 4,
    });
    const quadratic = weightedLabellerKappa(gold, answers, ['low', 'middle', 'high'], 'quadratic');
    expect(quadratic.kappa).toBeCloseTo(2 / 3, 12);
    expect(quadratic.observed).toBe(0.875);
    expect(quadratic.expected).toBe(0.625);
    expect(() => weightedLabellerKappa(['low'], [null], ['low', 'high'])).toThrow();
    expect(() => weightedLabellerKappa(['low'], ['none'], ['low', 'high'])).toThrow();
    expect(() => weightedLabellerKappa(['low'], ['low'], ['low', 'low'])).toThrow();
  });
});

describe('nominal multi-rater alpha', () => {
  it('uses pairable coincidences and excludes singletons from both marginals', () => {
    const result = labellerNominalAlpha(
      [
        ['amber', 'amber', 'azure', null],
        ['amber', 'azure', 'azure', null],
        ['amber', 'azure', null, 'amber'],
      ],
      labels,
    );
    expect(result).toMatchObject({
      alpha: 0.5625,
      observed: 0.25,
      pairable: 8,
      units: 4,
      raters: 3,
      missing: 3,
      unpairableUnits: 1,
      status: 'estimated',
    });
    expect(result.expected).toBeCloseTo(4 / 7, 12);
  });

  it('reports absent comparisons, constant agreement and rejects invalid/ragged raters', () => {
    expect(
      labellerNominalAlpha(
        [
          [null, 'amber'],
          [null, null],
        ],
        labels,
      ),
    ).toMatchObject({ alpha: null, pairable: 0, missing: 3, unpairableUnits: 2, status: 'insufficient' });
    expect(labellerNominalAlpha([['amber'], ['amber']], labels).alpha).toBe(1);
    expect(() => labellerNominalAlpha([['unknown'], ['unknown']], labels)).toThrow();
    expect(() => labellerNominalAlpha([['amber'], []], labels)).toThrow();
    expect(() => labellerNominalAlpha([['amber']], labels)).toThrow();
  });
});

describe('confusion and selective classification', () => {
  it('separates abstain and invalid columns and reports imbalanced per-class errors', () => {
    const result = labellerConfusion(
      ['amber', 'amber', 'azure', 'azure', 'none'],
      ['amber', 'azure', null, '?', 'none'],
      set('amber', 'azure', 'violet'),
    );
    expect(result.labels).toEqual(['amber', 'azure', 'violet', 'none']);
    expect(result.predictionColumns.slice(-2)).toEqual([{ kind: 'abstain' }, { kind: 'invalid' }]);
    expect(result.confusion).toEqual([
      [1, 1, 0, 0, 0, 0],
      [0, 0, 0, 0, 1, 1],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 0, 0],
    ]);
    expect(result.byLabel[0]).toMatchObject({
      tp: 1,
      fp: 0,
      fn: 1,
      support: 2,
      predicted: 1,
      precision: 1,
      recall: 0.5,
    });
    expect(result.byLabel[0]?.f1).toBeCloseTo(2 / 3, 12);
    expect(result.byLabel[1]).toMatchObject({ tp: 0, fp: 1, fn: 2, precision: 0, recall: 0, f1: 0 });
    expect(result.byLabel[2]).toMatchObject({ precision: null, recall: null, f1: null });
    expect(result.score).toMatchObject({ correct: 2, abstentions: 1, invalid: 1 });
  });

  const observations: ScoredLabellerObservation[] = [
    { gold: 'amber', answer: 'amber', confidence: 0.9 },
    { gold: 'azure', answer: 'amber', confidence: 0.5 },
    { gold: 'amber', answer: null, confidence: 1 },
    { gold: 'azure', answer: '?', confidence: 1 },
  ];
  it('retains exact binomial limits when tiny confidence rounds alpha to one', () => {
    const point = labellerCoverageCurve(observations, labels, [0], Number.MIN_VALUE)[0];
    expect(point?.acceptedAccuracyInterval?.lower).toBeCloseTo(1 - Math.sqrt(0.5), 12);
    expect(point?.acceptedAccuracyInterval?.upper).toBeCloseTo(Math.sqrt(0.5), 12);
  });
  it('retains the binomial upper tail at the largest supported confidence', () => {
    const confidence = 1 - Number.EPSILON / 2;
    const rows = Array.from({ length: 4 }, () => ({ gold: 'azure', answer: 'amber', confidence: 1 }));
    const point = labellerCoverageCurve(rows, labels, [0], confidence)[0];
    const expectedUpper = 1 - ((1 - confidence) / 2) ** 0.25;
    expect(point?.acceptedAccuracyInterval?.lower).toBe(0);
    expect(point?.acceptedAccuracyInterval?.upper).toBeCloseTo(expectedUpper, 12);
  });
  it('sorts thresholds, accepts inclusive ties, and refuses to accept invalid or abstain outputs', () => {
    const curve = labellerCoverageCurve(observations, labels, [0.6, 0, 0.6, 1]);
    expect(curve.map((point) => point.threshold)).toEqual([0, 0.6, 1]);
    expect(curve[0]).toMatchObject({
      accepted: 2,
      correct: 1,
      coverage: 0.5,
      acceptedAccuracy: 0.5,
      abstentions: 1,
      invalid: 1,
      belowThreshold: 0,
    });
    expect(curve[1]).toMatchObject({ accepted: 1, correct: 1, coverage: 0.25, acceptedAccuracy: 1 });
    expect(curve[1]?.acceptedAccuracyInterval?.lower).toBeCloseTo(0.025, 10);
    expect(curve[2]).toMatchObject({
      accepted: 0,
      acceptedAccuracy: null,
      acceptedAccuracyInterval: null,
      belowThreshold: 2,
    });
    expect(labellerCoverageCurve(observations, labels, [0.5])[0]?.accepted).toBe(2);
  });
  it('selects maximum feasible coverage with lower-threshold tie break or returns null', () => {
    expect(
      selectLabellerThreshold(observations, labels, { thresholds: [0, 0.6, 0.7, 1], minAccuracy: 1 })
        ?.threshold,
    ).toBe(0.6);
    expect(
      selectLabellerThreshold(observations, labels, {
        thresholds: [0, 0.6],
        minAccuracy: 1,
        minCoverage: 0.5,
      }),
    ).toBeNull();
    expect(() => labellerCoverageCurve(observations, labels, [])).toThrow();
    expect(() => labellerCoverageCurve(observations, labels, [NaN])).toThrow();
    expect(() =>
      labellerCoverageCurve(
        [{ ...(observations[0] as ScoredLabellerObservation), confidence: 2 }],
        labels,
        [0],
      ),
    ).toThrow();
  });
});

describe('explicit vocabulary mappings', () => {
  const options: LabellerMappingOptions = {
    goldSet: set('parcel'),
    answerSet: set('triangular', 'circular'),
    targetSet: set('parcel'),
    goldMap: [
      { source: 'parcel', target: 'parcel' },
      { source: 'none', target: 'none' },
    ],
    answerMap: [
      { source: 'triangular', target: 'parcel' },
      { source: 'circular', target: 'parcel' },
      { source: 'none', target: 'none' },
    ],
  };
  it('compares split classes only through an explicit shared parent mapping', () => {
    expect(
      scoreMappedLabeller(['parcel', 'none', 'parcel'], ['triangular', 'none', 'circular'], options),
    ).toMatchObject({ correct: 3, kappa: 1 });
    expect(scoreMappedLabeller(['parcel', 'parcel'], ['parcel', null], options)).toMatchObject({
      correct: 0,
      invalid: 1,
      abstentions: 1,
    });
  });
  it('rejects partial, ambiguous or unknown mappings instead of guessing', () => {
    expect(() =>
      scoreMappedLabeller(['parcel'], ['triangular'], { ...options, answerMap: options.answerMap.slice(1) }),
    ).toThrow();
    expect(() =>
      scoreMappedLabeller(['parcel'], ['triangular'], {
        ...options,
        answerMap: [...options.answerMap, { source: 'triangular', target: 'none' }],
      }),
    ).toThrow();
    expect(() => scoreMappedLabeller(['triangular'], ['triangular'], options)).toThrow();
  });
});

describe('exact fixed-margin kappa test', () => {
  it('counts each multiset permutation once and includes ties in every alternative', () => {
    const gold = ['amber', 'amber', 'azure', 'azure'];
    expect(exactLabellerKappaTest(gold, gold, labels, 'greater')).toEqual({
      kappa: 1,
      pValue: 1 / 6,
      permutations: 6,
      extreme: 1,
      alternative: 'greater',
      method: 'exact-fixed-margin-permutation',
    });
    expect(exactLabellerKappaTest(gold, gold, labels).pValue).toBe(1 / 3);
    expect(exactLabellerKappaTest(gold, ['azure', 'azure', 'amber', 'amber'], labels, 'less').pValue).toBe(
      1 / 6,
    );
    expect(exactLabellerKappaTest(gold, [null, null, null, null], labels).pValue).toBe(1);
    expect(exactLabellerKappaTest(['amber'], ['amber'], labels).pValue).toBe(1);
  });
  it('bounds enumeration and retains missing and invalid outputs as prediction categories', () => {
    expect(exactLabellerKappaTest(['amber', 'azure'], [null, 'unknown'], labels)).toMatchObject({
      kappa: 0,
      pValue: 1,
      permutations: 2,
      extreme: 2,
    });
    expect(() =>
      exactLabellerKappaTest(Array<string>(10).fill('amber'), Array<string>(10).fill('amber'), labels),
    ).toThrow();
    expect(() => exactLabellerKappaTest(['amber'], ['amber'], labels, 'other' as 'greater')).toThrow();
  });
});
