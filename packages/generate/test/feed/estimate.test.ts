import { describe, expect, it } from 'vitest';
import { estimateShares } from '../../src/feed';

describe('shares from decisions', () => {
  it('without a calibration set, gives the shares of the decisions and a Wilson interval', () => {
    const e = estimateShares({ values: [60, 40], unsure: 7, absent: 0 });
    expect(e.corrected).toBe(false);
    expect(e.shares).toEqual([0.6, 0.4]);
    expect(e.lower[0]).toBeCloseTo(0.502, 3);
    expect(e.upper[0]).toBeCloseTo(0.6905, 3);
  });

  it('recovers the true shares exactly from decisions that match a known confusion', () => {
    // true shares 0.7 / 0.3; the reader says "first" for 90% of the first class and 20% of the second, never unsure.
    const confusion = [
      [90, 10, 0, 0],
      [20, 80, 0, 0],
    ];
    const observedFirst = 0.7 * 0.9 + 0.3 * 0.2; // 0.69
    const e = estimateShares({ values: [690, 310], unsure: 0, absent: 0 }, confusion, { resamples: 50 });
    expect(observedFirst).toBeCloseTo(0.69, 10);
    expect(e.corrected).toBe(true);
    expect(e.shares[0]).toBeCloseTo(0.7, 3);
    expect(e.shares[1]).toBeCloseTo(0.3, 3);
  });

  it('uses the unsure decisions the calibration saw, so an unsure that favours one value does not bias the shares', () => {
    // class 0: 80 decided right, 20 unsure. class 1: 100 decided right. True shares 0.5 / 0.5: observed 400 / 500 / 100 unsure.
    const confusion = [
      [80, 0, 20, 0],
      [0, 100, 0, 0],
    ];
    const e = estimateShares({ values: [400, 500], unsure: 100, absent: 0 }, confusion, { resamples: 50 });
    expect(e.shares[0]).toBeCloseTo(0.5, 3);
  });

  it('keeps the point estimate inside its interval and the interval in [0, 1]', () => {
    const confusion = [
      [45, 5, 0, 0],
      [10, 40, 0, 0],
    ];
    const e = estimateShares({ values: [30, 70], unsure: 0, absent: 0 }, confusion, { seed: 3 });
    for (let i = 0; i < 2; i++) {
      expect(e.lower[i]).toBeLessThanOrEqual(e.shares[i] as number);
      expect(e.upper[i]).toBeGreaterThanOrEqual(e.shares[i] as number);
      expect(e.lower[i]).toBeGreaterThanOrEqual(0);
      expect(e.upper[i]).toBeLessThanOrEqual(1);
    }
  });

  it('gives the same interval for the same seed and a wider one for a smaller calibration set', () => {
    const big = [
      [900, 100, 0, 0],
      [200, 800, 0, 0],
    ];
    const small = [
      [9, 1, 0, 0],
      [2, 8, 0, 0],
    ];
    const tally = { values: [500, 500], unsure: 0, absent: 0 };
    const a = estimateShares(tally, big, { seed: 5 });
    const b = estimateShares(tally, big, { seed: 5 });
    const c = estimateShares(tally, small, { seed: 5 });
    expect(a).toEqual(b);
    expect((c.upper[0] as number) - (c.lower[0] as number)).toBeGreaterThan(
      (a.upper[0] as number) - (a.lower[0] as number),
    );
  });

  it('refuses what it cannot estimate', () => {
    expect(() => estimateShares({ values: [0, 0], unsure: 3, absent: 0 })).toThrow(
      /no conversation was decided/,
    );
    expect(() => estimateShares({ values: [5], unsure: 0, absent: 0 })).toThrow(/two values/);
    expect(() => estimateShares({ values: [5, 5], unsure: 0, absent: 0 }, [[1, 0, 0, 0]])).toThrow(
      /one row per value/,
    );
    expect(() =>
      estimateShares({ values: [5, 5], unsure: 0, absent: 0 }, [
        [1, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
    ).toThrow(/holds no conversation/);
  });
});
