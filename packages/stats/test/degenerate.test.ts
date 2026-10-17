import { describe, expect, it } from 'vitest';
import { designEffect, effectiveSampleSize, ksTest, mean, wilcoxonSignedRank, pageHinkley, quantile, quantileSorted, sampleVariance } from '../src/index';

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
