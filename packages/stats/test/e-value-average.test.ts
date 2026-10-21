import { describe, expect, it } from 'vitest';
import { eValueAverage } from '../src/index';

describe('eValueAverage', () => {
  it('averages e-values', () => {
    expect(eValueAverage([2, 4])).toBe(3);
    expect(eValueAverage([0, 0, 3])).toBe(1);
  });

  it('does not overflow on large finite e-values', () => {
    expect(eValueAverage([1.7e308, 1.7e308])).toBe(1.7e308);
    // Unequal values: the plain sum overflows and the fallback divides before adding.
    expect(eValueAverage([1.7e308, 1.6e308])).toBeCloseTo(1.65e308, -295);
    expect(Number.isFinite(eValueAverage([1.7e308, 1.6e308]))).toBe(true);
  });

  it('refuses an empty array, a negative and a non-finite value', () => {
    expect(() => eValueAverage([])).toThrow(RangeError);
    expect(() => eValueAverage([1, -0.5])).toThrow(RangeError);
    expect(() => eValueAverage([1, Number.NaN])).toThrow(RangeError);
    expect(() => eValueAverage([Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });
});
