import { describe, expect, it } from 'vitest';
import { mean, quantile, quantileSorted, sampleVariance } from '../src/index';

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
