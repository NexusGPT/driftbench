import { describe, expect, it } from 'vitest';
import { mean, quantile, quantileSorted, sampleVariance, unreliability } from '../src/index';

const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

describe('basics refuse non-finite data', () => {
  for (const v of bad) {
    it(`rejects ${v} in the data`, () => {
      const xs = [0.1, 0.5, v, 0.7, 0.9];
      expect(() => mean(xs)).toThrow(RangeError);
      expect(() => quantile(xs, 0.5)).toThrow(RangeError);
      expect(() => quantileSorted(xs, 0.9)).toThrow(RangeError);
      expect(() => sampleVariance(xs)).toThrow(RangeError);
      expect(() => unreliability(xs)).toThrow(RangeError);
    });
  }
  it('rejects a NaN quantile level', () => {
    expect(() => quantile([1, 2, 3], Number.NaN)).toThrow(RangeError);
    expect(() => quantileSorted([1, 2, 3], Number.NaN)).toThrow(RangeError);
  });
});
