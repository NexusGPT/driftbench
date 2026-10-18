import { describe, expect, it } from 'vitest';
import {
  benjaminiHochberg,
  betaQuantile,
  bootstrapCI,
  chaoCoverage,
  chiSquareSf,
  clopperPearson,
  cohenKappa,
  cusum,
  designEffect,
  effectiveSampleSize,
  goodTuring,
  hillNumber,
  hillNumbers,
  incompleteBeta,
  krippendorffAlpha,
  ksTest,
  logGamma,
  mcnemar,
  mde,
  mean,
  neymanAllocation,
  nonInferiority,
  normalCdf,
  pageHinkley,
  pairedRateDifference,
  passAtK,
  passK,
  quantile,
  quantileSorted,
  repeatsForFloor,
  sampleVariance,
  unreliability,
  varianceComponents,
  wilcoxonSignedRank,
  wilson,
  zeroFailureBound,
  zFor,
} from '../src/index';

/**
 * The degenerate-input contract, rule 1: a RangeError begins `<function>: <argument>`, so the caller sees which
 * argument to fix. A message that names no argument fails this contract.
 */
describe('RangeError names the function and the argument', () => {
  it('mean of an empty sample names values', () => {
    expect(() => mean([])).toThrow(RangeError);
    expect(() => mean([])).toThrow(/^mean: values/);
  });

  it('sampleVariance of an empty sample names values', () => {
    expect(() => sampleVariance([])).toThrow(/^sampleVariance: values/);
  });

  it('quantile of an empty sample names values', () => {
    expect(() => quantile([], 0.5)).toThrow(/^quantile: values/);
  });

  it('quantile level out of range names p', () => {
    expect(() => quantile([1, 2], 2)).toThrow(/^quantile: p/);
  });

  it('quantileSorted of an empty sample names sorted', () => {
    expect(() => quantileSorted([], 0.5)).toThrow(/^quantileSorted: sorted/);
  });

  it('mean of a NaN value names values and its index', () => {
    expect(() => mean([1, Number.NaN])).toThrow(/^mean: values\[1\]/);
  });

  it('mean of an infinite value names values and its index', () => {
    expect(() => mean([1, Number.POSITIVE_INFINITY])).toThrow(/^mean: values\[1\]/);
  });

  it('sampleVariance of an infinite value names values and its index', () => {
    expect(() => sampleVariance([1, Number.NEGATIVE_INFINITY, 2])).toThrow(/^sampleVariance: values\[1\]/);
  });

  it('quantile of a NaN value names values and its index', () => {
    expect(() => quantile([1, Number.NaN], 0.5)).toThrow(/^quantile: values\[1\]/);
  });

  it('quantileSorted of an infinite value names sorted and its index', () => {
    expect(() => quantileSorted([1, Number.POSITIVE_INFINITY], 0.5)).toThrow(/^quantileSorted: sorted\[1\]/);
  });

  it('cusum of a NaN value names series and its index', () => {
    expect(() => cusum([1, Number.NaN], { sd: 1 })).toThrow(/^cusum: series\[1\]/);
  });

  it('pageHinkley of an infinite value names series and its index', () => {
    expect(() => pageHinkley([1, Number.POSITIVE_INFINITY])).toThrow(/^pageHinkley: series\[1\]/);
  });

  it('ksTest of a NaN value in the first sample names a and its index', () => {
    expect(() => ksTest([1, Number.NaN], [1, 2])).toThrow(/^ksTest: a\[1\]/);
  });

  it('wilcoxonSignedRank of an infinite value names x and its index', () => {
    expect(() => wilcoxonSignedRank([1, Number.POSITIVE_INFINITY], [1, 2])).toThrow(
      /^wilcoxonSignedRank: x\[1\]/,
    );
  });

  it('unreliability of a NaN sample names samples and its index', () => {
    expect(() => unreliability([0.5, Number.NaN])).toThrow(/^unreliability: samples\[1\]/);
  });

  it('benjaminiHochberg of a NaN p-value names pvalues and its index', () => {
    expect(() => benjaminiHochberg([0.01, Number.NaN])).toThrow(/^benjaminiHochberg: pvalues\[1\]/);
  });

  it('bootstrapCI of an infinite value names values and its index', () => {
    expect(() => bootstrapCI([1, Number.NEGATIVE_INFINITY])).toThrow(/^bootstrapCI: values\[1\]/);
  });

  it('unreliability of no samples names samples', () => {
    expect(() => unreliability([])).toThrow(/^unreliability: samples/);
  });

  it('bootstrapCI of no values names values', () => {
    expect(() => bootstrapCI([])).toThrow(/^bootstrapCI: values/);
  });

  it('wilcoxonSignedRank of no pairs names x', () => {
    expect(() => wilcoxonSignedRank([], [])).toThrow(/^wilcoxonSignedRank: x/);
  });

  it('ksTest of an empty first sample names a', () => {
    expect(() => ksTest([], [1])).toThrow(/^ksTest: 'a'/);
  });

  it('cusum of an empty series names series', () => {
    expect(() => cusum([], { sd: 1 })).toThrow(/^cusum: series/);
  });

  it('pageHinkley of an empty series names series', () => {
    expect(() => pageHinkley([])).toThrow(/^pageHinkley: series/);
  });

  it('goodTuring of no observations names counts', () => {
    expect(() => goodTuring([])).toThrow(/^goodTuring: counts/);
  });

  it('chaoCoverage of no observations names counts', () => {
    expect(() => chaoCoverage([])).toThrow(/^chaoCoverage: counts/);
  });

  it('hillNumber of no observations names counts', () => {
    expect(() => hillNumber([], 2)).toThrow(/^hillNumber: counts/);
  });

  it('hillNumbers of no observations names counts', () => {
    expect(() => hillNumbers([])).toThrow(/^hillNumbers: counts/);
  });

  it('wilson of a non-integer count names k', () => {
    expect(() => wilson(1.5, 3)).toThrow(/^wilson: k/);
  });

  it('wilson of an infinite n names n', () => {
    expect(() => wilson(3, Number.POSITIVE_INFINITY)).toThrow(/^wilson: n/);
  });

  it('clopperPearson of alpha 0 names alpha', () => {
    expect(() => clopperPearson(2, 10, 0)).toThrow(/^clopperPearson: alpha/);
  });

  it('zeroFailureBound of p 1 names p', () => {
    expect(() => zeroFailureBound(1)).toThrow(/^zeroFailureBound: p/);
  });

  it('zFor of alpha 1 names alpha', () => {
    expect(() => zFor(1)).toThrow(/^zFor: alpha/);
  });

  it('designEffect of a cluster size below 1 names m', () => {
    expect(() => designEffect(0.5, 0.1)).toThrow(/^designEffect: m/);
  });

  it('mcnemar of a negative count names b', () => {
    expect(() => mcnemar(-1, 3)).toThrow(/^mcnemar: b/);
  });

  it('passK with c above n names passK and c', () => {
    expect(() => passK(5, 3, 1)).toThrow(/^passK: c/);
  });

  it('passAtK with k out of range names passAtK and k', () => {
    expect(() => passAtK(3, 5, 9)).toThrow(/^passAtK: k/);
  });
});

describe('varianceComponents names the observations argument', () => {
  const ok = { value: 1, path: ['a'] };
  const opts = { levels: ['cell'] };
  it('an empty list', () => {
    expect(() => varianceComponents([], opts)).toThrow(/^varianceComponents: observations/);
  });
  it('a value that is not finite', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => varianceComponents([ok, { value: bad, path: ['b'] }], opts)).toThrow(
        /^varianceComponents: observations\[1\]/,
      );
    }
  });
  it('a path of the wrong length', () => {
    expect(() => varianceComponents([ok, { value: 2, path: ['a', 'b'] }], opts)).toThrow(
      /^varianceComponents: observations\[1\]/,
    );
  });
});

describe('cusum and pageHinkley name the option they refuse', () => {
  const s = [1, 2, 3, 2, 1];
  it('cusum refuses a bad sd, k, h or warmup by name', () => {
    for (const sd of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      expect(() => cusum(s, { sd })).toThrow(/^cusum: sd/);
    }
    expect(() => cusum(s, { sd: 1, k: -0.5 })).toThrow(/^cusum: k/);
    expect(() => cusum(s, { sd: 1, h: Number.NaN })).toThrow(/^cusum: h/);
    expect(() => cusum(s, { sd: 1, warmup: 0 })).toThrow(/^cusum: warmup/);
  });
  it('pageHinkley refuses a bad delta or threshold by name', () => {
    expect(() => pageHinkley(s, { delta: Number.NaN })).toThrow(/^pageHinkley: delta/);
    expect(() => pageHinkley(s, { threshold: -1 })).toThrow(/^pageHinkley: threshold/);
  });
});

describe('scalar arguments that are not finite or out of range are named', () => {
  const N = Number.NaN;
  const I = Number.POSITIVE_INFINITY;
  it('wilson names z', () => {
    expect(() => wilson(3, 10, N)).toThrow(/^wilson: z/);
    expect(() => wilson(2, 10, -1.96)).toThrow(/^wilson: z/);
  });
  it('designEffect and effectiveSampleSize name m and n', () => {
    expect(() => designEffect(I, 0.1)).toThrow(/^designEffect: m/);
    expect(() => effectiveSampleSize(N, 4, 0.1)).toThrow(/^effectiveSampleSize: n/);
    expect(() => effectiveSampleSize(I, 4, 0.1)).toThrow(/^effectiveSampleSize: n/);
  });
  it('mde names n, repeats and rho', () => {
    expect(() => mde({ n: I, baselineRate: 0.8 })).toThrow(/^mde: n/);
    expect(() => mde({ n: 50, repeats: I, baselineRate: 0.8 })).toThrow(/^mde: repeats/);
    expect(() => mde({ n: 50, baselineRate: 0.8, rho: N })).toThrow(/^mde: rho/);
    expect(() => mde({ n: 50, baselineRate: 0.8, rho: 2 })).toThrow(/^mde: rho/);
  });
  it('quantile, hillNumber and betaQuantile name p and q', () => {
    expect(() => quantile([1, 2, 3], N)).toThrow(/^quantile: p/);
    expect(() => hillNumber([3, 2, 1], N)).toThrow(/^hillNumber: q/);
    expect(() => betaQuantile(N, 2, 3)).toThrow(/^betaQuantile: p/);
  });
  it('repeatsForFloor and neymanAllocation name variance, blocks and sizes', () => {
    expect(() => repeatsForFloor({ variance: I, floor: 0.05 })).toThrow(/^repeatsForFloor: variance/);
    expect(() => repeatsForFloor({ variance: 0.2, floor: 0.05, blocks: I })).toThrow(
      /^repeatsForFloor: blocks/,
    );
    expect(() => neymanAllocation({ sizes: [10, I], sds: [1, 1], total: 10 })).toThrow(
      /^neymanAllocation: sizes/,
    );
  });
});

describe('special functions at the edge of their domain give the scipy limit', () => {
  it('normalCdf at infinity', () => {
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
  });
  it('chiSquareSf at infinity and at df 0', () => {
    expect(chiSquareSf(Number.POSITIVE_INFINITY, 3)).toBe(0);
    expect(() => chiSquareSf(2, 0)).toThrow(/^chiSquareSf: df/);
  });
  it('logGamma at the poles', () => {
    expect(logGamma(0)).toBe(Number.POSITIVE_INFINITY);
    expect(logGamma(-2)).toBe(Number.POSITIVE_INFINITY);
  });
  it('incompleteBeta outside [0, 1] is NaN', () => {
    expect(incompleteBeta(1.5, 2, 3)).toBeNaN();
    expect(incompleteBeta(0, 2, 3)).toBe(0);
    expect(incompleteBeta(1, 2, 3)).toBe(1);
  });
});

describe('agreement, paired, drift and cluster refusals name their argument', () => {
  it('cohenKappa names a, b and weights', () => {
    expect(() => cohenKappa([], [])).toThrow(/^cohenKappa: 'a'/);
    expect(() => cohenKappa(['a', 'b'], ['a'])).toThrow(/^cohenKappa: 'a'/);
    expect(() => cohenKappa([1, 2], [1, 2], { weights: 'cubic' as never })).toThrow(/^cohenKappa: weights/);
  });
  it('krippendorffAlpha names matrix and level', () => {
    expect(() => krippendorffAlpha([])).toThrow(/^krippendorffAlpha: matrix/);
    expect(() => krippendorffAlpha([[], []])).toThrow(/^krippendorffAlpha: matrix/);
    expect(() =>
      krippendorffAlpha(
        [
          [1, 2],
          [1, 2],
        ],
        { level: 'cubic' as never },
      ),
    ).toThrow(/^krippendorffAlpha: level/);
  });
  it('nonInferiority, pairedRateDifference and wilcoxonSignedRank name their arguments', () => {
    expect(() => nonInferiority({ baseline: [], candidate: [], margin: 0.05 })).toThrow(
      /^nonInferiority: baseline/,
    );
    expect(() => nonInferiority({ baseline: [true, false], candidate: [true], margin: 0.05 })).toThrow(
      /^nonInferiority: baseline/,
    );
    expect(() => pairedRateDifference({ bothPass: 0, regressed: 0, improved: 0, bothFail: 0 })).toThrow(
      /^pairedRateDifference: table/,
    );
    expect(() => wilcoxonSignedRank([1, 2, 3], [1, 2])).toThrow(/^wilcoxonSignedRank: x/);
  });
  it('ksTest, bootstrapCI and quantileSorted name their arguments', () => {
    expect(() => ksTest([], [1])).toThrow(/^ksTest: 'a'/);
    expect(() => ksTest([1, 2], [3, 4], { method: 'magic' as never })).toThrow(/^ksTest: method/);
    expect(() => bootstrapCI([1, 2, 3], { clusters: [1, 2] })).toThrow(/^bootstrapCI: clusters/);
    expect(() => quantileSorted([3, 1, 2], 0.5)).toThrow(/^quantileSorted: sorted/);
  });
});

describe('mean is exact on equal values and does not overflow', () => {
  it('ten copies of 0.7 give 0.7', () => {
    expect(mean(Array.from({ length: 10 }, () => 0.7))).toBe(0.7);
  });
  it('three copies of 1e308 give 1e308', () => {
    expect(mean([1e308, 1e308, 1e308])).toBe(1e308);
  });
  it('unequal values near the largest double stay finite', () => {
    expect(mean([1.5e308, 1e308])).toBeCloseTo(1.25e308, -300);
  });
});
