import { describe, expect, it } from 'vitest';
import * as stats from '../src/index';

const weightedMean = (stats as unknown as Record<string, unknown>).weightedMean as (
  values: readonly number[],
  weights: readonly number[],
) => number;

// weightedMean(values, weights) = sum w x / sum w (numpy.average).
describe('weightedMean', () => {
  it('exists', () => {
    expect(typeof weightedMean).toBe('function');
  });

  it('matches the documented cases', () => {
    expect(weightedMean([1, 2, 3, 4], [1, 1, 1, 1])).toBeCloseTo(2.5, 12);
    expect(weightedMean([10, 20, 30], [3, 1, 1])).toBeCloseTo(16, 12);
    expect(weightedMean([0.2, 0.8, 0.5, 0.9, 0.1], [5, 1, 2, 2, 4])).toBeCloseTo(0.35714285714285715, 12);
  });

  it('gives an all-equal sample its value exactly', () => {
    expect(weightedMean([0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6], [1, 2, 3, 1, 2, 3, 1, 2, 3, 1])).toBe(0.6);
  });

  it('does not change its arguments', () => {
    const v = [3, 1, 2];
    const w = [1, 2, 3];
    weightedMean(v, w);
    expect(v).toEqual([3, 1, 2]);
    expect(w).toEqual([1, 2, 3]);
  });

  it('finishes 100000 values quickly', () => {
    const v = Array.from({ length: 100000 }, (_, i) => (i % 10) / 10);
    const w = Array.from({ length: 100000 }, (_, i) => 1 + (i % 3));
    const t = Date.now();
    expect(Number.isFinite(weightedMean(v, w))).toBe(true);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it('rejects bad input with a RangeError that names the function and the argument', () => {
    expect(() => weightedMean([], [])).toThrowError(/^weightedMean: values/);
    expect(() => weightedMean([1, Number.NaN, 3], [1, 1, 1])).toThrowError(/^weightedMean: values/);
    expect(() => weightedMean([1, Number.POSITIVE_INFINITY, 3], [1, 1, 1])).toThrowError(/^weightedMean: values/);
    expect(() => weightedMean([1, 2], [1])).toThrowError(/^weightedMean: values or weights/);
    expect(() => weightedMean([1, 2], [1, -1])).toThrowError(/^weightedMean: weights/);
    expect(() => weightedMean([1, 2], [1, Number.NaN])).toThrowError(/^weightedMean: weights/);
    expect(() => weightedMean([1, 2], [0, 0])).toThrowError(/^weightedMean: weights/);
  });
});
