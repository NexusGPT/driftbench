import type { Observation } from '@driftbench/stats';
import type { StatsImpl } from '../reference';
import { attempt, type BankItem, fail, near, ok, show, type Tier } from './item';

/**
 * Level `degenerate`: inputs a careless caller sends. The contract, one rule per kind of input:
 * 1. A statistical procedure refuses input it cannot answer for (no data, NaN, an infinite value, a count or a
 *    probability out of range) by throwing a RangeError. It never returns a number built from that input.
 * 2. A special function (packages/stats/src/special.ts) given NaN returns NaN or throws a RangeError; it never
 *    returns a finite number. At the edge of its domain it returns the limit scipy returns.
 * 3. On a valid degenerate input (one value, all values equal) a function returns the defined answer, never NaN.
 */

const FILE: Record<string, string> = {
  mean: 'packages/stats/src/basics.ts',
  sampleVariance: 'packages/stats/src/basics.ts',
  quantile: 'packages/stats/src/basics.ts',
  quantileSorted: 'packages/stats/src/basics.ts',
  unreliability: 'packages/stats/src/reliability.ts',
  passK: 'packages/stats/src/reliability.ts',
  passAtK: 'packages/stats/src/reliability.ts',
  bootstrapCI: 'packages/stats/src/intervals.ts',
  wilson: 'packages/stats/src/intervals.ts',
  clopperPearson: 'packages/stats/src/intervals.ts',
  zeroFailureBound: 'packages/stats/src/intervals.ts',
  designEffect: 'packages/stats/src/intervals.ts',
  effectiveSampleSize: 'packages/stats/src/intervals.ts',
  zFor: 'packages/stats/src/intervals.ts',
  wilcoxonSignedRank: 'packages/stats/src/paired.ts',
  mcnemar: 'packages/stats/src/paired.ts',
  pairedRateDifference: 'packages/stats/src/paired.ts',
  nonInferiority: 'packages/stats/src/paired.ts',
  ksTest: 'packages/stats/src/drift.ts',
  cusum: 'packages/stats/src/drift.ts',
  pageHinkley: 'packages/stats/src/drift.ts',
  kolmogorovSf: 'packages/stats/src/drift.ts',
  benjaminiHochberg: 'packages/stats/src/multiple.ts',
  mde: 'packages/stats/src/power.ts',
  hillNumbers: 'packages/stats/src/coverage.ts',
  hillNumber: 'packages/stats/src/coverage.ts',
  chaoCoverage: 'packages/stats/src/coverage.ts',
  goodTuring: 'packages/stats/src/coverage.ts',
  cohenKappa: 'packages/stats/src/agreement.ts',
  krippendorffAlpha: 'packages/stats/src/agreement.ts',
  varianceComponents: 'packages/stats/src/variance.ts',
  neymanAllocation: 'packages/stats/src/variance.ts',
  repeatsForFloor: 'packages/stats/src/variance.ts',
  logGamma: 'packages/stats/src/special.ts',
  incompleteBeta: 'packages/stats/src/special.ts',
  betaQuantile: 'packages/stats/src/special.ts',
  normalCdf: 'packages/stats/src/special.ts',
  normalQuantile: 'packages/stats/src/special.ts',
  chiSquareSf: 'packages/stats/src/special.ts',
  binomialCdf: 'packages/stats/src/special.ts',
};

type Expect =
  | { kind: 'throws' }
  | { kind: 'nan-or-throws' }
  | { kind: 'value'; want: string; test(value: unknown): boolean };

type Case = {
  /** The function under test. */
  fn: string;
  /** The case name in the item id. */
  name: string;
  family: string;
  tier: Tier;
  /** The call as the message prints it, from the drawn values. */
  call(rng: () => number): { text: string; run(s: StatsImpl): unknown };
  expect: Expect;
};

/** A few draws in [lo, hi), rounded to 3 decimals so the message stays short. */
function draws(rng: () => number, n: number, lo = 0, hi = 1): number[] {
  return Array.from({ length: n }, () => Math.round((lo + (hi - lo) * rng()) * 1000) / 1000);
}

/** The values with one entry replaced by `bad` at a drawn position. */
function plant(rng: () => number, values: number[], bad: number): number[] {
  const out = [...values];
  out[Math.floor(rng() * out.length)] = bad;
  return out;
}

const fmt = (values: readonly unknown[]): string =>
  `[${values.map((v) => (typeof v === 'number' ? String(v) : JSON.stringify(v))).join(', ')}]`;

/** The array functions, called on one array of numbers (the second argument built from it where needed). */
const ARRAY_CALLS: Array<{ fn: string; text(v: string): string; run(s: StatsImpl, v: number[]): unknown }> = [
  { fn: 'mean', text: (v) => `mean(${v})`, run: (s, v) => s.mean(v) },
  { fn: 'quantile', text: (v) => `quantile(${v}, 0.5)`, run: (s, v) => s.quantile(v, 0.5) },
  {
    fn: 'quantileSorted',
    text: (v) => `quantileSorted(${v}, 0.9)`,
    run: (s, v) =>
      s.quantileSorted(
        [...v].sort((a, b) => a - b),
        0.9,
      ),
  },
  { fn: 'sampleVariance', text: (v) => `sampleVariance(${v})`, run: (s, v) => s.sampleVariance(v) },
  { fn: 'unreliability', text: (v) => `unreliability(${v})`, run: (s, v) => s.unreliability(v) },
  {
    fn: 'bootstrapCI',
    text: (v) => `bootstrapCI(${v}, { iterations: 50 })`,
    run: (s, v) => s.bootstrapCI(v, { iterations: 50 }),
  },
  {
    fn: 'wilcoxonSignedRank',
    text: (v) => `wilcoxonSignedRank(${v}, the same values plus 0.5)`,
    run: (s, v) =>
      s.wilcoxonSignedRank(
        v,
        v.map((x) => x + 0.5),
      ),
  },
  {
    fn: 'ksTest',
    text: (v) => `ksTest(${v}, the same values plus 0.25)`,
    run: (s, v) =>
      s.ksTest(
        v,
        v.map((x) => x + 0.25),
      ),
  },
  { fn: 'cusum', text: (v) => `cusum(${v}, { sd: 1 })`, run: (s, v) => s.cusum(v, { sd: 1 }) },
  { fn: 'pageHinkley', text: (v) => `pageHinkley(${v})`, run: (s, v) => s.pageHinkley(v) },
  { fn: 'benjaminiHochberg', text: (v) => `benjaminiHochberg(${v})`, run: (s, v) => s.benjaminiHochberg(v) },
  {
    fn: 'varianceComponents',
    text: (v) =>
      `varianceComponents(one observation per value of ${v}, levels ['cell'], cells alternating a, b)`,
    run: (s, v) =>
      s.varianceComponents(
        v.map((value, i): Observation => ({ value, path: [i % 2 === 0 ? 'a' : 'b'] })),
        { levels: ['cell'] },
      ),
  },
];

/** The count functions, called on abundances. */
const COUNT_CALLS: Array<{ fn: string; text(v: string): string; run(s: StatsImpl, v: number[]): unknown }> = [
  { fn: 'hillNumbers', text: (v) => `hillNumbers(${v})`, run: (s, v) => s.hillNumbers(v) },
  { fn: 'hillNumber', text: (v) => `hillNumber(${v}, 2)`, run: (s, v) => s.hillNumber(v, 2) },
  { fn: 'chaoCoverage', text: (v) => `chaoCoverage(${v})`, run: (s, v) => s.chaoCoverage(v) },
  { fn: 'goodTuring', text: (v) => `goodTuring(${v})`, run: (s, v) => s.goodTuring(v) },
  {
    fn: 'neymanAllocation',
    text: (v) => `neymanAllocation({ sizes: ${v}, sds: all 0.5, total: 10 })`,
    run: (s, v) => s.neymanAllocation({ sizes: v, sds: v.map(() => 0.5), total: 10 }),
  },
];

const finiteDeep = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteDeep);
  if (value && typeof value === 'object') return Object.values(value).every(finiteDeep);
  return true;
};

function cases(): Case[] {
  const out: Case[] = [];
  // Empty input: a RangeError (benjaminiHochberg answers an empty list with empty lists).
  for (const c of [...ARRAY_CALLS, ...COUNT_CALLS]) {
    out.push({
      fn: c.fn,
      name: 'empty',
      family: 'degenerate-empty',
      tier: 2,
      call: () => ({ text: c.text('[]'), run: (s) => c.run(s, []) }),
      expect:
        c.fn === 'benjaminiHochberg'
          ? {
              kind: 'value',
              want: '{ adjusted: [], rejected: [] }',
              test: (v) => {
                const r = v as { adjusted?: unknown[]; rejected?: unknown[] };
                return Array.isArray(r?.adjusted) && r.adjusted.length === 0 && r.rejected?.length === 0;
              },
            }
          : { kind: 'throws' },
    });
  }
  // Empty pairs and raters.
  const empties: Array<[string, string, (s: StatsImpl) => unknown]> = [
    ['cohenKappa', 'cohenKappa([], [])', (s) => s.cohenKappa([], [])],
    ['krippendorffAlpha', 'krippendorffAlpha([[], []])', (s) => s.krippendorffAlpha([[], []])],
    ['krippendorffAlpha', 'krippendorffAlpha([])', (s) => s.krippendorffAlpha([])],
    [
      'nonInferiority',
      'nonInferiority({ baseline: [], candidate: [], margin: 0.05 })',
      (s) => s.nonInferiority({ baseline: [], candidate: [], margin: 0.05 }),
    ],
    ['mcnemar', 'mcnemar(0, 0) (no discordant pair)', (s) => s.mcnemar(0, 0)],
    [
      'pairedRateDifference',
      'pairedRateDifference({ bothPass: 0, regressed: 0, improved: 0, bothFail: 0 })',
      (s) => s.pairedRateDifference({ bothPass: 0, regressed: 0, improved: 0, bothFail: 0 }),
    ],
  ];
  for (const [fn, text, run] of empties) {
    const name = `empty-${text
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
      .slice(0, 40)}`;
    out.push({
      fn,
      name,
      family: 'degenerate-empty',
      tier: 2,
      call: () => ({ text, run }),
      // No discordant pair is a valid answer for McNemar: p = 1.
      expect:
        fn === 'mcnemar'
          ? {
              kind: 'value',
              want: 'pValue 1 and a finite statistic',
              test: (v) => (v as { pValue: number }).pValue === 1 && finiteDeep(v),
            }
          : { kind: 'throws' },
    });
  }
  // NaN and Infinity inside the data: a RangeError.
  for (const [bad, label] of [
    [Number.NaN, 'nan'],
    [Number.POSITIVE_INFINITY, 'infinity'],
    [Number.NEGATIVE_INFINITY, 'minus-infinity'],
  ] as const) {
    for (const c of ARRAY_CALLS) {
      out.push({
        fn: c.fn,
        name: `${label}-in-data`,
        family: 'degenerate-nonfinite',
        tier: 2,
        call: (rng) => {
          const v = plant(rng, draws(rng, 6, 0.01, 0.99), bad);
          return { text: c.text(fmt(v)), run: (s) => c.run(s, v) };
        },
        expect: { kind: 'throws' },
      });
    }
  }
  for (const c of COUNT_CALLS) {
    out.push({
      fn: c.fn,
      name: 'nan-in-counts',
      family: 'degenerate-nonfinite',
      tier: 2,
      call: (rng) => {
        const v = plant(
          rng,
          Array.from({ length: 6 }, () => 1 + Math.floor(rng() * 5)),
          Number.NaN,
        );
        return { text: c.text(fmt(v)), run: (s) => c.run(s, v) };
      },
      expect: { kind: 'throws' },
    });
  }
  // NaN scalars: procedures throw, special functions give NaN or throw.
  const nanScalars: Array<[string, string, (s: StatsImpl) => unknown, Expect['kind']]> = [
    ['wilson', 'wilson(NaN, 10)', (s) => s.wilson(Number.NaN, 10), 'throws'],
    ['wilson', 'wilson(3, 10, NaN)', (s) => s.wilson(3, 10, Number.NaN), 'throws'],
    ['clopperPearson', 'clopperPearson(3, 10, NaN)', (s) => s.clopperPearson(3, 10, Number.NaN), 'throws'],
    ['zeroFailureBound', 'zeroFailureBound(NaN)', (s) => s.zeroFailureBound(Number.NaN), 'throws'],
    ['designEffect', 'designEffect(4, NaN)', (s) => s.designEffect(4, Number.NaN), 'throws'],
    [
      'effectiveSampleSize',
      'effectiveSampleSize(NaN, 4, 0.1)',
      (s) => s.effectiveSampleSize(Number.NaN, 4, 0.1),
      'throws',
    ],
    ['zFor', 'zFor(NaN)', (s) => s.zFor(Number.NaN), 'throws'],
    ['passK', 'passK(NaN, 10, 2)', (s) => s.passK(Number.NaN, 10, 2), 'throws'],
    ['mcnemar', 'mcnemar(NaN, 3)', (s) => s.mcnemar(Number.NaN, 3), 'throws'],
    [
      'pairedRateDifference',
      'pairedRateDifference({ bothPass: NaN, regressed: 1, improved: 2, bothFail: 3 })',
      (s) => s.pairedRateDifference({ bothPass: Number.NaN, regressed: 1, improved: 2, bothFail: 3 }),
      'throws',
    ],
    ['mde', 'mde({ n: 50, baselineRate: NaN })', (s) => s.mde({ n: 50, baselineRate: Number.NaN }), 'throws'],
    [
      'mde',
      'mde({ n: NaN, baselineRate: 0.8 })',
      (s) => s.mde({ n: Number.NaN, baselineRate: 0.8 }),
      'throws',
    ],
    [
      'mde',
      'mde({ n: 50, baselineRate: 0.8, rho: NaN })',
      (s) => s.mde({ n: 50, baselineRate: 0.8, rho: Number.NaN }),
      'throws',
    ],
    [
      'repeatsForFloor',
      'repeatsForFloor({ variance: NaN, floor: 0.05 })',
      (s) => s.repeatsForFloor({ variance: Number.NaN, floor: 0.05 }),
      'throws',
    ],
    [
      'repeatsForFloor',
      'repeatsForFloor({ variance: 0.2, floor: NaN })',
      (s) => s.repeatsForFloor({ variance: 0.2, floor: Number.NaN }),
      'throws',
    ],
    [
      'neymanAllocation',
      'neymanAllocation({ sizes: [10, 20], sds: [NaN, 0.5], total: 10 })',
      (s) => s.neymanAllocation({ sizes: [10, 20], sds: [Number.NaN, 0.5], total: 10 }),
      'throws',
    ],
    ['hillNumber', 'hillNumber([3, 2, 1], NaN)', (s) => s.hillNumber([3, 2, 1], Number.NaN), 'throws'],
    [
      'benjaminiHochberg',
      'benjaminiHochberg([0.01, 0.2], NaN)',
      (s) => s.benjaminiHochberg([0.01, 0.2], Number.NaN),
      'throws',
    ],
    [
      'cusum',
      'cusum([1, 2, 3, 2, 1], { sd: NaN })',
      (s) => s.cusum([1, 2, 3, 2, 1], { sd: Number.NaN }),
      'throws',
    ],
    [
      'cusum',
      'cusum([1, 2, 3, 2, 1], { sd: 1, h: NaN })',
      (s) => s.cusum([1, 2, 3, 2, 1], { sd: 1, h: Number.NaN }),
      'throws',
    ],
    ['quantile', 'quantile([1, 2, 3], NaN)', (s) => s.quantile([1, 2, 3], Number.NaN), 'throws'],
    ['logGamma', 'logGamma(NaN)', (s) => s.logGamma(Number.NaN), 'nan-or-throws'],
    [
      'incompleteBeta',
      'incompleteBeta(NaN, 2, 3)',
      (s) => s.incompleteBeta(Number.NaN, 2, 3),
      'nan-or-throws',
    ],
    [
      'incompleteBeta',
      'incompleteBeta(0.4, NaN, 3)',
      (s) => s.incompleteBeta(0.4, Number.NaN, 3),
      'nan-or-throws',
    ],
    ['betaQuantile', 'betaQuantile(NaN, 2, 3)', (s) => s.betaQuantile(Number.NaN, 2, 3), 'nan-or-throws'],
    ['normalCdf', 'normalCdf(NaN)', (s) => s.normalCdf(Number.NaN), 'nan-or-throws'],
    ['normalQuantile', 'normalQuantile(NaN)', (s) => s.normalQuantile(Number.NaN), 'nan-or-throws'],
    ['chiSquareSf', 'chiSquareSf(NaN, 2)', (s) => s.chiSquareSf(Number.NaN, 2), 'nan-or-throws'],
    ['chiSquareSf', 'chiSquareSf(3, NaN)', (s) => s.chiSquareSf(3, Number.NaN), 'nan-or-throws'],
    ['binomialCdf', 'binomialCdf(3, 10, NaN)', (s) => s.binomialCdf(3, 10, Number.NaN), 'nan-or-throws'],
    ['kolmogorovSf', 'kolmogorovSf(NaN)', (s) => s.kolmogorovSf(Number.NaN), 'nan-or-throws'],
  ];
  for (const [fn, text, run, kind] of nanScalars) {
    out.push({
      fn,
      name: `nan-${text
        .replace(/[^a-z0-9]+/gi, '-')
        .toLowerCase()
        .slice(0, 48)}`,
      family: 'degenerate-nonfinite',
      tier: 2,
      call: () => ({ text, run }),
      expect: kind === 'throws' ? { kind: 'throws' } : { kind: 'nan-or-throws' },
    });
  }
  // Out of domain: a RangeError, or the scipy limit at the edge.
  const value = (want: string, test: (v: unknown) => boolean): Expect => ({ kind: 'value', want, test });
  const domain: Array<[string, string, (s: StatsImpl) => unknown, Expect]> = [
    ['wilson', 'wilson(5, 3)', (s) => s.wilson(5, 3), { kind: 'throws' }],
    ['wilson', 'wilson(1.5, 3)', (s) => s.wilson(1.5, 3), { kind: 'throws' }],
    ['wilson', 'wilson(2, 10, -1.96)', (s) => s.wilson(2, 10, -1.96), { kind: 'throws' }],
    ['clopperPearson', 'clopperPearson(2, 10, 0)', (s) => s.clopperPearson(2, 10, 0), { kind: 'throws' }],
    ['clopperPearson', 'clopperPearson(11, 10)', (s) => s.clopperPearson(11, 10), { kind: 'throws' }],
    ['zeroFailureBound', 'zeroFailureBound(1)', (s) => s.zeroFailureBound(1), { kind: 'throws' }],
    ['designEffect', 'designEffect(0.5, 0.1)', (s) => s.designEffect(0.5, 0.1), { kind: 'throws' }],
    ['designEffect', 'designEffect(4, 1.5)', (s) => s.designEffect(4, 1.5), { kind: 'throws' }],
    ['passK', 'passK(5, 3, 1)', (s) => s.passK(5, 3, 1), { kind: 'throws' }],
    ['passAtK', 'passAtK(2, 5, 6)', (s) => s.passAtK(2, 5, 6), { kind: 'throws' }],
    ['mcnemar', 'mcnemar(-1, 3)', (s) => s.mcnemar(-1, 3), { kind: 'throws' }],
    ['mcnemar', 'mcnemar(1.5, 3)', (s) => s.mcnemar(1.5, 3), { kind: 'throws' }],
    [
      'pairedRateDifference',
      'pairedRateDifference({ bothPass: -2, regressed: 1, improved: 2, bothFail: 3 })',
      (s) => s.pairedRateDifference({ bothPass: -2, regressed: 1, improved: 2, bothFail: 3 }),
      { kind: 'throws' },
    ],
    [
      'pairedRateDifference',
      'pairedRateDifference(table, alpha 1.2)',
      (s) => s.pairedRateDifference({ bothPass: 5, regressed: 1, improved: 2, bothFail: 3 }, 1.2),
      { kind: 'throws' },
    ],
    ['mde', 'mde({ n: 50, baselineRate: 1 })', (s) => s.mde({ n: 50, baselineRate: 1 }), { kind: 'throws' }],
    [
      'mde',
      'mde({ n: 50, baselineRate: 0.8, rho: 2 })',
      (s) => s.mde({ n: 50, baselineRate: 0.8, rho: 2 }),
      { kind: 'throws' },
    ],
    [
      'benjaminiHochberg',
      'benjaminiHochberg([0.01, 1.5])',
      (s) => s.benjaminiHochberg([0.01, 1.5]),
      { kind: 'throws' },
    ],
    [
      'benjaminiHochberg',
      'benjaminiHochberg([0.01, -0.2])',
      (s) => s.benjaminiHochberg([0.01, -0.2]),
      { kind: 'throws' },
    ],
    [
      'benjaminiHochberg',
      'benjaminiHochberg([0.01, 0.2], 0)',
      (s) => s.benjaminiHochberg([0.01, 0.2], 0),
      { kind: 'throws' },
    ],
    ['quantile', 'quantile([1, 2, 3], 1.5)', (s) => s.quantile([1, 2, 3], 1.5), { kind: 'throws' }],
    [
      'bootstrapCI',
      'bootstrapCI([1, 2, 3], { alpha: 0 })',
      (s) => s.bootstrapCI([1, 2, 3], { alpha: 0 }),
      { kind: 'throws' },
    ],
    [
      'bootstrapCI',
      'bootstrapCI([1, 2, 3], { iterations: 0 })',
      (s) => s.bootstrapCI([1, 2, 3], { iterations: 0 }),
      { kind: 'throws' },
    ],
    [
      'neymanAllocation',
      'neymanAllocation({ sizes: [10, -1], sds: [1, 1], total: 10 })',
      (s) => s.neymanAllocation({ sizes: [10, -1], sds: [1, 1], total: 10 }),
      { kind: 'throws' },
    ],
    [
      'neymanAllocation',
      'neymanAllocation({ sizes: [10, 5], sds: [1, 1], total: 2.5 })',
      (s) => s.neymanAllocation({ sizes: [10, 5], sds: [1, 1], total: 2.5 }),
      { kind: 'throws' },
    ],
    ['chaoCoverage', 'chaoCoverage([3, -1, 2])', (s) => s.chaoCoverage([3, -1, 2]), { kind: 'throws' }],
    ['cohenKappa', 'cohenKappa([a, b], [a])', (s) => s.cohenKappa(['a', 'b'], ['a']), { kind: 'throws' }],
    [
      'repeatsForFloor',
      'repeatsForFloor({ flipRate: 1.5, floor: 0.05 })',
      (s) => s.repeatsForFloor({ flipRate: 1.5, floor: 0.05 }),
      { kind: 'throws' },
    ],
    [
      'normalQuantile',
      'normalQuantile(0)',
      (s) => s.normalQuantile(0),
      value('-Infinity (scipy norm.ppf(0))', (v) => v === Number.NEGATIVE_INFINITY),
    ],
    ['normalQuantile', 'normalQuantile(1.5)', (s) => s.normalQuantile(1.5), { kind: 'nan-or-throws' }],
    [
      'normalCdf',
      'normalCdf(Infinity)',
      (s) => s.normalCdf(Number.POSITIVE_INFINITY),
      value('1', (v) => v === 1),
    ],
    [
      'normalCdf',
      'normalCdf(-Infinity)',
      (s) => s.normalCdf(Number.NEGATIVE_INFINITY),
      value('0', (v) => v === 0),
    ],
    [
      'chiSquareSf',
      'chiSquareSf(-1, 2)',
      (s) => s.chiSquareSf(-1, 2),
      value('1 (scipy chi2.sf(-1, 2))', (v) => v === 1),
    ],
    [
      'chiSquareSf',
      'chiSquareSf(Infinity, 3)',
      (s) => s.chiSquareSf(Number.POSITIVE_INFINITY, 3),
      value('0', (v) => v === 0),
    ],
    ['chiSquareSf', 'chiSquareSf(2, 0)', (s) => s.chiSquareSf(2, 0), { kind: 'nan-or-throws' }],
    [
      'binomialCdf',
      'binomialCdf(-1, 10, 0.3)',
      (s) => s.binomialCdf(-1, 10, 0.3),
      value('0 (scipy binom.cdf(-1, 10, 0.3))', (v) => v === 0),
    ],
    [
      'binomialCdf',
      'binomialCdf(12, 10, 0.3)',
      (s) => s.binomialCdf(12, 10, 0.3),
      value('1', (v) => v === 1),
    ],
    ['binomialCdf', 'binomialCdf(3, 10, 1.5)', (s) => s.binomialCdf(3, 10, 1.5), { kind: 'nan-or-throws' }],
    [
      'logGamma',
      'logGamma(0)',
      (s) => s.logGamma(0),
      value('Infinity (scipy gammaln(0))', (v) => v === Number.POSITIVE_INFINITY),
    ],
    [
      'logGamma',
      'logGamma(-2)',
      (s) => s.logGamma(-2),
      value('Infinity (scipy gammaln(-2), a pole)', (v) => v === Number.POSITIVE_INFINITY),
    ],
    [
      'incompleteBeta',
      'incompleteBeta(1.5, 2, 3)',
      (s) => s.incompleteBeta(1.5, 2, 3),
      { kind: 'nan-or-throws' },
    ],
    [
      'incompleteBeta',
      'incompleteBeta(0, 2, 3)',
      (s) => s.incompleteBeta(0, 2, 3),
      value('0', (v) => v === 0),
    ],
    [
      'incompleteBeta',
      'incompleteBeta(1, 2, 3)',
      (s) => s.incompleteBeta(1, 2, 3),
      value('1', (v) => v === 1),
    ],
    ['betaQuantile', 'betaQuantile(0, 2, 3)', (s) => s.betaQuantile(0, 2, 3), value('0', (v) => v === 0)],
    ['betaQuantile', 'betaQuantile(1, 2, 3)', (s) => s.betaQuantile(1, 2, 3), value('1', (v) => v === 1)],
    ['kolmogorovSf', 'kolmogorovSf(0)', (s) => s.kolmogorovSf(0), value('1', (v) => v === 1)],
    ['kolmogorovSf', 'kolmogorovSf(-1)', (s) => s.kolmogorovSf(-1), value('1', (v) => v === 1)],
    [
      'kolmogorovSf',
      'kolmogorovSf(Infinity)',
      (s) => s.kolmogorovSf(Number.POSITIVE_INFINITY),
      value('0', (v) => v === 0),
    ],
    ['zFor', 'zFor(1)', (s) => s.zFor(1), { kind: 'throws' }],
    [
      'hillNumber',
      'hillNumber([3, 2, 1], -1) (q below 0 is valid: sum p^-1 to the power 1/2)',
      (s) => s.hillNumber([3, 2, 1], -1),
      value(
        'the Hill number of order -1, (sum of 1/p)^(1/2) = sqrt(2 + 3 + 6) = 3.31662',
        (v) => typeof v === 'number' && near(v, Math.sqrt(11), 1e-9),
      ),
    ],
  ];
  for (const [fn, text, run, expect] of domain) {
    out.push({
      fn,
      name: `domain-${text
        .replace(/[^a-z0-9]+/gi, '-')
        .toLowerCase()
        .slice(0, 48)}`,
      family: 'degenerate-domain',
      tier: 2,
      call: () => ({ text, run }),
      expect,
    });
  }
  // One value and all values equal: the defined answer.
  const single = (x: number) => [x];
  const equal = (x: number) => [x, x, x, x, x];
  const valueCases: Array<
    [
      string,
      string,
      (rng: () => number) => {
        text: string;
        run(s: StatsImpl): unknown;
        want: string;
        test(v: unknown): boolean;
      },
    ]
  > = [
    [
      'mean',
      'single',
      (rng) => {
        const x = draws(rng, 1, 1, 9)[0] as number;
        return { text: `mean([${x}])`, run: (s) => s.mean(single(x)), want: String(x), test: (v) => v === x };
      },
    ],
    [
      'quantile',
      'single',
      (rng) => {
        const x = draws(rng, 1, 1, 9)[0] as number;
        return {
          text: `quantile([${x}], 0.3)`,
          run: (s) => s.quantile(single(x), 0.3),
          want: String(x),
          test: (v) => v === x,
        };
      },
    ],
    [
      'unreliability',
      'single',
      (rng) => {
        const x = draws(rng, 1)[0] as number;
        return {
          text: `unreliability([${x}])`,
          run: (s) => s.unreliability(single(x)),
          want: '0',
          test: (v) => v === 0,
        };
      },
    ],
    [
      'unreliability',
      'equal',
      (rng) => {
        const x = draws(rng, 1)[0] as number;
        return {
          text: `unreliability(${fmt(equal(x))})`,
          run: (s) => s.unreliability(equal(x)),
          want: '0',
          test: (v) => v === 0,
        };
      },
    ],
    [
      'sampleVariance',
      'equal',
      (rng) => {
        const x = draws(rng, 1, 1e3, 1e4)[0] as number;
        return {
          text: `sampleVariance(${fmt(equal(x))})`,
          run: (s) => s.sampleVariance(equal(x)),
          want: '0 exactly',
          test: (v) => v === 0,
        };
      },
    ],
    [
      'mean',
      'equal-large',
      (rng) => {
        const x = 0.1 + Math.floor(rng() * 9) / 10;
        const v = Array.from({ length: 10 }, () => x);
        return {
          text: `mean(ten copies of ${x})`,
          run: (s) => s.mean(v),
          want: `${x} exactly (an all-equal sample has its value as mean)`,
          test: (r) => r === x,
        };
      },
    ],
    [
      'bootstrapCI',
      'single',
      (rng) => {
        const x = draws(rng, 1)[0] as number;
        return {
          text: `bootstrapCI([${x}], { iterations: 20 })`,
          run: (s) => s.bootstrapCI(single(x), { iterations: 20 }),
          want: `estimate, lower and upper all ${x}`,
          test: (v) => {
            const r = v as { estimate: number; lower: number; upper: number };
            return r.estimate === x && r.lower === x && r.upper === x;
          },
        };
      },
    ],
    [
      'bootstrapCI',
      'equal',
      (rng) => {
        const x = draws(rng, 1)[0] as number;
        return {
          text: `bootstrapCI(${fmt(equal(x))}, { iterations: 20, method: 'basic' })`,
          run: (s) => s.bootstrapCI(equal(x), { iterations: 20, method: 'basic' }),
          want: `estimate, lower and upper all ${x}`,
          test: (v) => {
            const r = v as { estimate: number; lower: number; upper: number };
            return r.estimate === x && r.lower === x && r.upper === x;
          },
        };
      },
    ],
    [
      'wilcoxonSignedRank',
      'equal',
      (rng) => {
        const v = draws(rng, 6);
        return {
          text: `wilcoxonSignedRank(${fmt(v)}, the same)`,
          run: (s) => s.wilcoxonSignedRank(v, v),
          want: 'pValue 1, statistic 0',
          test: (r) => (r as { pValue: number }).pValue === 1 && (r as { statistic: number }).statistic === 0,
        };
      },
    ],
    [
      'ksTest',
      'equal',
      (rng) => {
        const v = draws(rng, 6);
        return {
          text: `ksTest(${fmt(v)}, the same)`,
          run: (s) => s.ksTest(v, v),
          want: 'statistic 0, pValue 1',
          test: (r) => (r as { pValue: number }).pValue === 1 && (r as { statistic: number }).statistic === 0,
        };
      },
    ],
    [
      'ksTest',
      'single',
      () => ({
        text: 'ksTest([1], [2])',
        run: (s) => s.ksTest([1], [2]),
        want: 'statistic 1, pValue 1 (scipy ks_2samp([1], [2]))',
        test: (r) => (r as { pValue: number }).pValue === 1 && (r as { statistic: number }).statistic === 1,
      }),
    ],
    [
      'wilcoxonSignedRank',
      'single',
      () => ({
        text: 'wilcoxonSignedRank([2], [1])',
        run: (s) => s.wilcoxonSignedRank([2], [1]),
        want: 'pValue 1 (scipy wilcoxon([1]))',
        test: (r) => (r as { pValue: number }).pValue === 1,
      }),
    ],
    [
      'pageHinkley',
      'equal',
      (rng) => {
        const x = draws(rng, 1)[0] as number;
        const v = Array.from({ length: 40 }, () => x);
        return {
          text: `pageHinkley(forty copies of ${x})`,
          run: (s) => s.pageHinkley(v),
          want: 'no alarm and finite statistics',
          test: (r) => (r as { alarms: unknown[] }).alarms.length === 0 && finiteDeep(r),
        };
      },
    ],
    [
      'benjaminiHochberg',
      'single',
      (rng) => {
        const p = draws(rng, 1, 0.001, 0.04)[0] as number;
        return {
          text: `benjaminiHochberg([${p}])`,
          run: (s) => s.benjaminiHochberg([p]),
          want: `adjusted [${p}], rejected [true]`,
          test: (r) =>
            (r as { adjusted: number[] }).adjusted[0] === p &&
            (r as { rejected: boolean[] }).rejected[0] === true,
        };
      },
    ],
    [
      'benjaminiHochberg',
      'equal-ones',
      () => ({
        text: 'benjaminiHochberg([1, 1, 1])',
        run: (s) => s.benjaminiHochberg([1, 1, 1]),
        want: 'adjusted [1, 1, 1], none rejected, threshold null',
        test: (r) => {
          const x = r as { adjusted: number[]; rejected: boolean[]; threshold: number | null };
          return x.adjusted.every((a) => a === 1) && x.rejected.every((b) => !b) && x.threshold === null;
        },
      }),
    ],
    [
      'hillNumbers',
      'single-class',
      (rng) => {
        const c = 1 + Math.floor(rng() * 9);
        return {
          text: `hillNumbers([${c}])`,
          run: (s) => s.hillNumbers([c]),
          want: 'q0 1, q1 1, q2 1',
          test: (r) => {
            const h = r as { q0: number; q1: number; q2: number };
            return h.q0 === 1 && h.q1 === 1 && h.q2 === 1;
          },
        };
      },
    ],
    [
      'hillNumbers',
      'equal',
      (rng) => {
        const c = 1 + Math.floor(rng() * 9);
        return {
          text: `hillNumbers([${c}, ${c}, ${c}, ${c}])`,
          run: (s) => s.hillNumbers([c, c, c, c]),
          want: 'q0 4, q1 4, q2 4 (to 1e-12)',
          test: (r) => {
            const h = r as { q0: number; q1: number; q2: number };
            return h.q0 === 4 && near(h.q1, 4, 1e-12) && near(h.q2, 4, 1e-12);
          },
        };
      },
    ],
    [
      'chaoCoverage',
      'single-class',
      () => ({
        text: 'chaoCoverage([5])',
        run: (s) => s.chaoCoverage([5]),
        want: 'coverage 1, chao1 1',
        test: (r) => (r as { coverage: number }).coverage === 1 && (r as { chao1: number }).chao1 === 1,
      }),
    ],
    [
      'goodTuring',
      'single-unit',
      () => ({
        text: 'goodTuring([1])',
        run: (s) => s.goodTuring([1]),
        want: 'discoveryProbability 1, coverage 0',
        test: (r) =>
          (r as { discoveryProbability: number }).discoveryProbability === 1 &&
          (r as { coverage: number }).coverage === 0,
      }),
    ],
    [
      'cohenKappa',
      'identical',
      (rng) => {
        const a = Array.from({ length: 8 }, (_, i) => (i % 3 === 0 ? 'x' : rng() < 0.5 ? 'y' : 'z'));
        return {
          text: `cohenKappa(${fmt(a)}, the same)`,
          run: (s) => s.cohenKappa(a, a),
          want: 'kappa 1',
          test: (r) => near((r as { kappa: number }).kappa, 1, 1e-12),
        };
      },
    ],
    [
      'cohenKappa',
      'one-label',
      () => ({
        text: "cohenKappa(['x', 'x', 'x'], ['x', 'x', 'x'])",
        run: (s) => s.cohenKappa(['x', 'x', 'x'], ['x', 'x', 'x']),
        want: 'kappa 1 (perfect agreement with one category; the chance-corrected ratio is 0 / 0 and the defined answer is 1)',
        test: (r) => (r as { kappa: number }).kappa === 1,
      }),
    ],
    [
      'krippendorffAlpha',
      'identical',
      (rng) => {
        const a = Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? 'x' : rng() < 0.5 ? 'y' : 'z'));
        return {
          text: `krippendorffAlpha([${fmt(a)}, the same])`,
          run: (s) => s.krippendorffAlpha([a, a]),
          want: 'alpha 1',
          test: (r) => near((r as { alpha: number }).alpha, 1, 1e-12),
        };
      },
    ],
    [
      'varianceComponents',
      'equal',
      (rng) => {
        const x = draws(rng, 1)[0] as number;
        const obs: Observation[] = Array.from({ length: 12 }, (_, i) => ({
          value: x,
          path: [String(i % 3), String(i % 2)],
        }));
        return {
          text: `varianceComponents(12 observations all ${x}, levels ['cell', 'conversation'])`,
          run: (s) => s.varianceComponents(obs, { levels: ['cell', 'conversation'] }),
          want: 'every variance 0, every share 0, total 0, no NaN',
          test: (r) => {
            const v = r as { total: number; components: Array<{ variance: number; share: number }> };
            return v.total === 0 && v.components.every((c) => c.variance === 0 && c.share === 0);
          },
        };
      },
    ],
    [
      'neymanAllocation',
      'single-stratum',
      (rng) => {
        const t = 5 + Math.floor(rng() * 20);
        return {
          text: `neymanAllocation({ sizes: [7], sds: [0.4], total: ${t} })`,
          run: (s) => s.neymanAllocation({ sizes: [7], sds: [0.4], total: t }),
          want: `allocated [${t}]`,
          test: (r) => (r as { allocated: number[] }).allocated[0] === t,
        };
      },
    ],
    [
      'cusum',
      'single',
      () => ({
        text: 'cusum([3], { sd: 1 })',
        run: (s) => s.cusum([3], { sd: 1 }),
        want: 'upper [0], lower [0], no alarm',
        test: (r) => {
          const c = r as { upper: number[]; lower: number[]; alarms: unknown[] };
          return c.upper[0] === 0 && c.lower[0] === 0 && c.alarms.length === 0;
        },
      }),
    ],
    [
      'passK',
      'all-pass',
      (rng) => {
        const n = 2 + Math.floor(rng() * 8);
        return {
          text: `passK(${n}, ${n}, ${n})`,
          run: (s) => s.passK(n, n, n),
          want: '1',
          test: (v) => v === 1,
        };
      },
    ],
    [
      'wilson',
      'zero-of-one',
      () => ({
        text: 'wilson(0, 1)',
        run: (s) => s.wilson(0, 1),
        want: 'lower 0 exactly and upper (z^2 / 2 + z sqrt(z^2 / 4)) / (1 + z^2) = 0.79345068562 with z = 1.959963984540054',
        test: (r) =>
          (r as { lower: number }).lower === 0 &&
          near((r as { upper: number }).upper, 0.7934506856227626, 1e-12),
      }),
    ],
  ];
  for (const [fn, name, build] of valueCases) {
    out.push({
      fn,
      name,
      family: 'degenerate-single-equal',
      tier: 2,
      call: (rng) => build(rng),
      expect: { kind: 'value', want: '', test: () => true },
    });
  }
  return out;
}

/** The id, with a counter appended when an earlier case already took it. */
function unique(seen: Map<string, number>, id: string): string {
  const count = (seen.get(id) ?? 0) + 1;
  seen.set(id, count);
  return count === 1 ? id : `${id}-${count}`;
}

/** The degenerate items, one per case. */
export function degenerateItems(): BankItem[] {
  const seen = new Map<string, number>();
  return cases().map((c) => ({
    id: unique(seen, `degenerate.${c.fn}.${c.name.replace(/-+$/, '')}`),
    family: c.family,
    tier: c.tier,
    level: 'degenerate',
    component: FILE[c.fn] ?? 'packages/stats/src',
    check: ({ s, rng }) => {
      const built = c.call(rng) as {
        text: string;
        run(s: StatsImpl): unknown;
        want?: string;
        test?(v: unknown): boolean;
      };
      const got = attempt(() => built.run(s));
      const where = `${c.fn} in ${FILE[c.fn] ?? 'packages/stats/src'}`;
      const happened = got.error
        ? `it threw ${got.error.name}: ${got.error.message}`
        : `it returned ${show(got.value)}`;
      const expect: Expect =
        built.test && built.want !== undefined
          ? { kind: 'value', want: built.want, test: built.test }
          : c.expect;
      if (expect.kind === 'throws') {
        if (got.error instanceof RangeError) return ok();
        return fail(
          `${built.text} must throw a RangeError (degenerate-input contract, rule 1); ${happened}. Add the check to ${where}.`,
        );
      }
      if (expect.kind === 'nan-or-throws') {
        if (got.error instanceof RangeError || (typeof got.value === 'number' && Number.isNaN(got.value)))
          return ok();
        return fail(
          `${built.text} must return NaN or throw a RangeError (contract, rule 2); ${happened}. Fix ${where}.`,
        );
      }
      if (!got.error && expect.test(got.value)) return ok();
      return fail(
        `${built.text} must give ${expect.want} (contract, rule ${c.family === 'degenerate-domain' ? 2 : 3}); ${happened}. Fix ${where}.`,
      );
    },
  }));
}
