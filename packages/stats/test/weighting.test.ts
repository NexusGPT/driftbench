import { describe, expect, it } from 'vitest';
import { weightedMean } from '../src/index';

describe('weightedMean', () => {
  it('matches numpy.average', () => {
    expect(weightedMean([1, 2, 3, 4], [1, 1, 1, 1])).toBe(2.5);
    expect(weightedMean([10, 20, 30], [3, 1, 1])).toBe(16);
    expect(weightedMean([0.2, 0.8, 0.5, 0.9, 0.1], [5, 1, 2, 2, 4])).toBeCloseTo(0.35714285714285715, 14);
  });
  it('throws a RangeError on input it cannot answer for', () => {
    expect(() => weightedMean([], [])).toThrow(RangeError);
    expect(() => weightedMean([1, 2], [1])).toThrow(RangeError);
    expect(() => weightedMean([Number.NaN, 2], [1, 1])).toThrow(RangeError);
    expect(() => weightedMean([Number.POSITIVE_INFINITY, 2], [1, 1])).toThrow(RangeError);
    expect(() => weightedMean([1, 2], [1, -1])).toThrow(/weights\[1\]/);
    expect(() => weightedMean([1, 2], [0, 0])).toThrow(RangeError);
  });
  it('leaves its arguments as it found them', () => {
    const v = [3, 1, 2];
    const w = [1, 2, 3];
    weightedMean(v, w);
    expect(v).toEqual([3, 1, 2]);
    expect(w).toEqual([1, 2, 3]);
  });
});
