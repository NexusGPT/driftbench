import { describe, expect, it } from 'vitest';
import { betaQuantile, cusum, chiSquareSf, incompleteBeta, logGamma, designEffect, normalCdf, normalSf, effectiveSampleSize, ksTest, mean, wilcoxonSignedRank, pageHinkley, quantile, quantileSorted, sampleVariance } from '../src/index';

const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

describe('basics refuse non-finite input (degenerate-input contract, rule 1)', () => {
  for (const b of bad) {
    it(`mean, quantile, quantileSorted and sampleVariance throw a RangeError on ${b}`, () => {
      const xs = [0.1, 0.2, b, 0.4, 0.5, 0.6];
      expect(() => mean(xs)).toThrow(RangeError);
      expect(() => quantile(xs, 0.5)).toThrow(RangeError);
      expect(() => quantileSorted(xs, 0.5)).toThrow(RangeError);
      expect(() => sampleVariance(xs)).toThrow(RangeError);
    });
  }
  it('quantile and quantileSorted refuse a NaN level', () => {
    expect(() => quantile([1, 2, 3], Number.NaN)).toThrow(RangeError);
    expect(() => quantileSorted([1, 2, 3], Number.NaN)).toThrow(RangeError);
  });
  it('quantileSorted refuses unsorted input', () => {
    expect(() => quantileSorted([3, 1, 2], 0.5)).toThrow(RangeError);
  });
  it('still answers on ordinary input', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(quantile([3, 1, 2], 0.5)).toBe(2);
    expect(sampleVariance([1, 2, 3])).toBe(1);
  });
});

describe('pageHinkley refuses input it cannot answer for', () => {
  const series = [1, 2, 3];
  it('throws a RangeError on an empty series', () => {
    expect(() => pageHinkley([])).toThrow(RangeError);
  });
  it('throws a RangeError on a non-finite value', () => {
    for (const b of bad) expect(() => pageHinkley([0.4, b, 0.2, 0.1])).toThrow(RangeError);
  });
  it('throws a RangeError on a bad option', () => {
    expect(() => pageHinkley(series, { threshold: -1 })).toThrow(RangeError);
    expect(() => pageHinkley(series, { delta: Number.NaN })).toThrow(RangeError);
    expect(() => pageHinkley(series, { threshold: Number.NaN })).toThrow(RangeError);
    expect(() => pageHinkley(series, { delta: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => pageHinkley(series, { minInstances: -1 })).toThrow(RangeError);
    expect(() => pageHinkley(series, { minInstances: 1.5 })).toThrow(RangeError);
  });
  it('still detects a shift', () => {
    const xs = [...new Array<number>(40).fill(0), ...new Array<number>(40).fill(10)];
    expect(pageHinkley(xs, { threshold: 20, minInstances: 5 }).alarms.length).toBeGreaterThan(0);
  });
});

describe('ksTest refuses input it cannot answer for', () => {
  it('throws a RangeError on a non-finite value in either sample (a NaN used to loop for ever)', () => {
    for (const b of bad) {
      expect(() => ksTest([1, 2, b, 4], [1.5, 2.5, 3.5])).toThrow(RangeError);
      expect(() => ksTest([1, 2, 3], [1.5, b, 3.5])).toThrow(RangeError);
    }
  });
  it('throws a RangeError on an unknown method', () => {
    expect(() => ksTest([1, 2], [3, 4], { method: 'magic' as never })).toThrow(RangeError);
  });
  it('still answers on ordinary input', () => {
    expect(ksTest([1, 2, 3], [4, 5, 6]).statistic).toBe(1);
  });
});

describe('wilcoxonSignedRank refuses a non-finite value', () => {
  const x = [0.4, 0.2, 0.9, 0.5, 0.1, 0.7];
  it('throws a RangeError on NaN, Infinity and -Infinity in either sample', () => {
    for (const b of bad) {
      expect(() => wilcoxonSignedRank([0.4, b, 0.9, 0.5, 0.1, 0.7], x.map((v) => v + 0.5))).toThrow(RangeError);
      expect(() => wilcoxonSignedRank(x, [0.4, b, 0.9, 0.5, 0.1, 0.7])).toThrow(RangeError);
    }
  });
  it('still answers on ordinary input', () => {
    expect(wilcoxonSignedRank(x, x.map((v) => v + 0.5)).pValue).toBeLessThan(0.05);
  });
});

describe('designEffect and effectiveSampleSize refuse non-finite input', () => {
  it('designEffect throws a RangeError on an infinite or NaN cluster size or rho', () => {
    expect(() => designEffect(Number.POSITIVE_INFINITY, 0.1)).toThrow(RangeError);
    expect(() => designEffect(Number.NaN, 0.1)).toThrow(RangeError);
    expect(() => designEffect(4, Number.NaN)).toThrow(RangeError);
  });
  it('effectiveSampleSize throws a RangeError on an infinite or NaN n, m or rho', () => {
    expect(() => effectiveSampleSize(Number.POSITIVE_INFINITY, 4, 0.1)).toThrow(RangeError);
    expect(() => effectiveSampleSize(Number.NaN, 4, 0.1)).toThrow(RangeError);
    expect(() => effectiveSampleSize(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 0.1)).toThrow(RangeError);
    expect(() => effectiveSampleSize(100, 4, Number.NaN)).toThrow(RangeError);
  });
  it('still answers on ordinary input', () => {
    expect(designEffect(5, 0.25)).toBe(2);
    expect(effectiveSampleSize(100, 5, 0.25)).toBe(50);
  });
});

describe('all-equal samples give the defined answer exactly (rule 3)', () => {
  it('mean of ten copies of 0.6 is 0.6, and of 1000 copies of 0.1 is 0.1', () => {
    expect(mean(new Array<number>(10).fill(0.6))).toBe(0.6);
    expect(mean(new Array<number>(1000).fill(0.1))).toBe(0.1);
    expect(mean(new Array<number>(7).fill(-3.3))).toBe(-3.3);
  });
  it('sample variance of an all-equal sample is exactly 0', () => {
    expect(sampleVariance(new Array<number>(10).fill(0.6))).toBe(0);
    expect(sampleVariance(new Array<number>(1000).fill(0.1))).toBe(0);
  });
  it('mean and variance of ordinary values are unchanged', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(sampleVariance([1, 2, 3, 4])).toBeCloseTo(5 / 3, 12);
  });
});

describe('normalCdf and chiSquareSf at the edge of their domain (rule 2)', () => {
  it('normalCdf gives the limits at infinity and NaN for NaN', () => {
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(normalCdf(Number.NaN)).toBeNaN();
    expect(normalSf(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalSf(Number.NEGATIVE_INFINITY)).toBe(1);
  });
  it('chiSquareSf gives 0 at infinity, and NaN or a RangeError for a non-positive df', () => {
    expect(chiSquareSf(Number.POSITIVE_INFINITY, 3)).toBe(0);
    const bad = (f: () => number): boolean => {
      try {
        return Number.isNaN(f());
      } catch (e) {
        return e instanceof RangeError;
      }
    };
    expect(bad(() => chiSquareSf(2, 0))).toBe(true);
    expect(bad(() => chiSquareSf(2, -1))).toBe(true);
    expect(bad(() => chiSquareSf(2, Number.NaN))).toBe(true);
  });
  it('ordinary values are unchanged', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 15);
    expect(chiSquareSf(3.841458820694124, 1)).toBeCloseTo(0.05, 10);
  });
});

describe('logGamma, incompleteBeta and betaQuantile outside their domain (rule 2)', () => {
  const nanOrThrow = (f: () => number): boolean => {
    try {
      return Number.isNaN(f());
    } catch (e) {
      return e instanceof RangeError;
    }
  };
  it('logGamma is +Infinity at the poles 0, -1, -2', () => {
    expect(logGamma(0)).toBe(Number.POSITIVE_INFINITY);
    expect(logGamma(-1)).toBe(Number.POSITIVE_INFINITY);
    expect(logGamma(-2)).toBe(Number.POSITIVE_INFINITY);
  });
  it('logGamma still matches the reference between the poles', () => {
    expect(logGamma(-0.5)).toBeCloseTo(1.2655121234846454, 12);
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 12);
  });
  it('incompleteBeta returns NaN or throws for x outside [0, 1], non-positive shapes and NaN', () => {
    expect(nanOrThrow(() => incompleteBeta(1.5, 2, 3))).toBe(true);
    expect(nanOrThrow(() => incompleteBeta(-0.1, 2, 3))).toBe(true);
    expect(nanOrThrow(() => incompleteBeta(0.5, 0, 3))).toBe(true);
    expect(nanOrThrow(() => incompleteBeta(0.5, 2, -1))).toBe(true);
    expect(nanOrThrow(() => incompleteBeta(Number.NaN, 2, 3))).toBe(true);
    expect(incompleteBeta(0, 2, 3)).toBe(0);
    expect(incompleteBeta(1, 2, 3)).toBe(1);
  });
  it('betaQuantile returns NaN or throws for a NaN or out-of-range level and bad shapes', () => {
    expect(nanOrThrow(() => betaQuantile(Number.NaN, 2, 3))).toBe(true);
    expect(nanOrThrow(() => betaQuantile(1.5, 2, 3))).toBe(true);
    expect(nanOrThrow(() => betaQuantile(0.5, 0, 3))).toBe(true);
    expect(betaQuantile(0, 2, 3)).toBe(0);
    expect(betaQuantile(1, 2, 3)).toBe(1);
  });
});

describe('cusum refuses options that are not finite or out of range', () => {
  const series = [1, 2, 3, 2, 1];
  it('throws a RangeError on a non-finite or negative sd, k, h, target or a bad warmup', () => {
    expect(() => cusum(series, { sd: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => cusum(series, { sd: Number.NaN })).toThrow(RangeError);
    expect(() => cusum(series, { sd: 1, k: -0.5 })).toThrow(RangeError);
    expect(() => cusum(series, { sd: 1, k: Number.NaN })).toThrow(RangeError);
    expect(() => cusum(series, { sd: 1, h: Number.NaN })).toThrow(RangeError);
    expect(() => cusum(series, { sd: 1, h: -1 })).toThrow(RangeError);
    expect(() => cusum(series, { sd: 1, target: Number.NaN })).toThrow(RangeError);
    expect(() => cusum(series, { warmup: 0 })).toThrow(RangeError);
    expect(() => cusum(series, { warmup: 1.5 })).toThrow(RangeError);
  });
  it('still answers with valid options', () => {
    expect(cusum(series, { sd: 1, target: 2 }).alarms).toEqual([]);
  });
});
