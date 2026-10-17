import { describe, expect, it } from 'vitest';
import { ksTest, mean, pageHinkley, quantile, quantileSorted, sampleVariance } from '../src/index';

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
