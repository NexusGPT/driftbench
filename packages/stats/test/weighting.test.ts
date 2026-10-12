import { describe, expect, it } from 'vitest';
import {
  clusteredMeanInterval,
  designEffectFromData,
  iccOneWay,
  kishEffectiveSize,
  oneWayAnova,
  stratifiedMean,
  weightedMean,
} from '../src/index';

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

describe('designEffectFromData', () => {
  it('is 1 + (mean cluster size - 1) ICC(1)', () => {
    expect(
      designEffectFromData([1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1], [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4]),
    ).toBeCloseTo(0.9377615062761506, 12);
    expect(designEffectFromData([3, 4, 5, 9, 8, 10, 2, 3, 1, 4], [1, 1, 1, 2, 2, 2, 3, 3, 4, 4])).toBeCloseTo(
      2.2981818181818183,
      12,
    );
  });
  it('throws a RangeError on input iccOneWay refuses', () => {
    expect(() => designEffectFromData([], [])).toThrow(RangeError);
    expect(() => designEffectFromData([1, Number.NaN, 2, 3], [1, 1, 2, 2])).toThrow(RangeError);
  });
});

describe('clusteredMeanInterval', () => {
  it('is the mean plus or minus t(G - 1) times the clustered standard error', () => {
    const a = clusteredMeanInterval([1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1], [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4]);
    expect(a.estimate).toBeCloseTo(0.6363636363636364, 12);
    expect(a.lower).toBeCloseTo(0.21719133898111592, 9);
    expect(a.upper).toBeCloseTo(1.0555359337461567, 9);
    const b = clusteredMeanInterval([3, 4, 5, 9, 8, 10, 2, 3, 1, 4], [1, 1, 1, 2, 2, 2, 3, 3, 4, 4]);
    expect(b.lower).toBeCloseTo(0.34721051254551316, 9);
    expect(b.upper).toBeCloseTo(9.452789487454488, 9);
  });
  it('throws a RangeError on input it cannot answer for', () => {
    expect(() => clusteredMeanInterval([], [])).toThrow(RangeError);
    expect(() => clusteredMeanInterval([1, 2], [1])).toThrow(RangeError);
    expect(() => clusteredMeanInterval([Number.NaN, 2, 3, 4], [1, 1, 2, 2])).toThrow(RangeError);
    expect(() => clusteredMeanInterval([1, 2, 3], [1, 1, 1])).toThrow(/two clusters/);
    expect(() => clusteredMeanInterval([1, 2, 3, 4], [1, 1, 2, 2], 1.5)).toThrow(/alpha/);
  });
});

describe('oneWayAnova', () => {
  it('matches scipy.stats.f_oneway', () => {
    const r = oneWayAnova([
      [2.9, 3.0, 2.5, 2.6, 3.2],
      [3.8, 2.7, 4.0, 2.4],
      [2.8, 3.4, 3.7, 2.2, 2.0],
    ]);
    expect(r.df1).toBe(2);
    expect(r.df2).toBe(11);
    expect(r.statistic).toBeCloseTo(0.56007326007326, 9);
    expect(r.pValue).toBeCloseTo(0.5866329910417377, 9);
    const q = oneWayAnova([
      [1.0, 2.0, 3.0, 4.5],
      [3.0, 4.0, 5.5, 6.0],
      [5.0, 6.5, 7.0, 8.0],
    ]);
    expect(q.pValue).toBeCloseTo(0.00862617881079356, 9);
  });
  it('gives an infinite F and a zero p when groups differ without within-group spread', () => {
    expect(
      oneWayAnova([
        [1, 1],
        [2, 2],
      ]),
    ).toMatchObject({ statistic: Number.POSITIVE_INFINITY, pValue: 0 });
  });
  it('throws a RangeError on input it cannot answer for', () => {
    expect(() => oneWayAnova([])).toThrow(RangeError);
    expect(() => oneWayAnova([[1, 2]])).toThrow(RangeError);
    expect(() => oneWayAnova([[1, 2], []])).toThrow(RangeError);
    expect(() =>
      oneWayAnova([
        [Number.NaN, 2],
        [3, 4],
      ]),
    ).toThrow(RangeError);
    expect(() => oneWayAnova([[1], [2]])).toThrow(RangeError);
    expect(() =>
      oneWayAnova([
        [1, 1],
        [1, 1],
      ]),
    ).toThrow(RangeError);
  });
});

describe('stratifiedMean', () => {
  it('is sum W_h ybar_h with the finite population corrected variance', () => {
    const a = stratifiedMean({
      means: [0.8, 0.6, 0.9],
      sizes: [100, 50, 50],
      sds: [0.4, 0.49, 0.3],
      samples: [20, 10, 10],
    });
    expect(a.estimate).toBeCloseTo(0.775, 12);
    expect(a.variance).toBeCloseTo(0.0032505000000000004, 12);
    const b = stratifiedMean({ means: [10, 20], sizes: [1000, 3000], sds: [2, 5], samples: [50, 100] });
    expect(b.estimate).toBeCloseTo(17.5, 12);
    expect(b.variance).toBeCloseTo(0.1406875, 12);
  });
  it('has no variance from a stratum sampled completely', () => {
    expect(stratifiedMean({ means: [1, 2], sizes: [5, 5], sds: [1, 1], samples: [5, 5] }).variance).toBe(0);
  });
  it('throws a RangeError on input it cannot answer for', () => {
    const ok = { means: [1, 2], sizes: [10, 10], sds: [1, 1], samples: [5, 5] };
    expect(() => stratifiedMean({ means: [], sizes: [], sds: [], samples: [] })).toThrow(RangeError);
    expect(() => stratifiedMean({ ...ok, sds: [1] })).toThrow(RangeError);
    expect(() => stratifiedMean({ ...ok, means: [Number.NaN, 2] })).toThrow(RangeError);
    expect(() => stratifiedMean({ ...ok, sds: [-1, 1] })).toThrow(/sds\[0\]/);
    expect(() => stratifiedMean({ ...ok, samples: [11, 5] })).toThrow(/samples\[0\]/);
    expect(() => stratifiedMean({ ...ok, samples: [0, 5] })).toThrow(RangeError);
  });
});
