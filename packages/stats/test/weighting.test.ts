import { describe, expect, it } from 'vitest';
import { iccOneWay, kishEffectiveSize, weightedMean } from '../src/index';

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

describe('kishEffectiveSize', () => {
  it('is (sum w)^2 / sum w^2', () => {
    expect(kishEffectiveSize([1, 1, 1, 1])).toBe(4);
    expect(kishEffectiveSize([1, 2, 3, 4])).toBeCloseTo(3.3333333333333335, 14);
    expect(kishEffectiveSize([10, 1, 1, 1, 1])).toBeCloseTo(1.8846153846153846, 14);
  });
  it('throws a RangeError on input it cannot answer for', () => {
    expect(() => kishEffectiveSize([])).toThrow(RangeError);
    expect(() => kishEffectiveSize([1, Number.NaN])).toThrow(RangeError);
    expect(() => kishEffectiveSize([Number.POSITIVE_INFINITY, 1])).toThrow(RangeError);
    expect(() => kishEffectiveSize([1, -1])).toThrow(/weights\[1\]/);
    expect(() => kishEffectiveSize([0, 0])).toThrow(RangeError);
  });
});

describe('iccOneWay', () => {
  it('matches the unbalanced one-way ANOVA ICC(1), not truncated', () => {
    expect(iccOneWay([1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1], [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4])).toBeCloseTo(
      -0.03556485355648538,
      12,
    );
    expect(
      iccOneWay([0.2, 0.4, 0.9, 0.8, 0.1, 0.5, 0.7, 0.6], ['a', 'a', 'b', 'b', 'c', 'c', 'd', 'd']),
    ).toBeCloseTo(0.6872037914691944, 12);
    expect(iccOneWay([3, 4, 5, 9, 8, 10, 2, 3, 1, 4], [1, 1, 1, 2, 2, 2, 3, 3, 4, 4])).toBeCloseTo(
      0.8654545454545455,
      12,
    );
  });
  it('throws a RangeError on input it cannot answer for', () => {
    expect(() => iccOneWay([], [])).toThrow(RangeError);
    expect(() => iccOneWay([1, 2], [1])).toThrow(RangeError);
    expect(() => iccOneWay([Number.NaN, 2, 3, 4], [1, 1, 2, 2])).toThrow(RangeError);
    expect(() => iccOneWay([1, 2, 3], [1, 1, 1])).toThrow(/two clusters/);
    expect(() => iccOneWay([1, 2, 3], [1, 2, 3])).toThrow(RangeError);
  });
});
