import { describe, expect, it } from 'vitest';
import { clopperPearson } from '../src/intervals';
import { betaQuantile, betaQuantileFromLogP } from '../src/special';
import reference from './reference/clopper-pearson-tail.json';

/**
 * The exact interval at significance levels near the smallest double. The reference (see
 * reference/make_clopper_pearson_tail_fixtures.py) solves the exact binomial tails at 160 digits at the exact
 * double alpha, with no beta function. alpha / 2 underflows to 0 at Number.MIN_VALUE, so a limit computed from
 * the linear probability alpha / 2 is the end of its range, not the limit.
 */

function close(actual: number, expected: number): void {
  expect(Number.isFinite(actual)).toBe(true);
  if (expected === 0 || expected === 1) {
    expect(actual).toBe(expected);
    return;
  }
  // A subnormal limit has fewer than 52 bits: one or two steps of the grid, Number.MIN_VALUE each, are the same number.
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    Math.max(Math.abs(expected) * 1e-11, 2 * Number.MIN_VALUE),
  );
}

describe('clopperPearson against the exact tails at extreme alpha', () => {
  for (const c of reference.cases) {
    it(`k=${c.k} n=${c.n} alpha=${c.alpha}`, () => {
      const interval = clopperPearson(c.k, c.n, c.alpha);
      close(interval.lower, c.lower);
      close(interval.upper, c.upper);
      expect(interval.estimate).toBe(c.k / c.n);
    });
  }

  it('does not give the whole range at Number.MIN_VALUE when the data narrow it', () => {
    const interval = clopperPearson(50, 100, Number.MIN_VALUE);
    expect(interval.lower).toBeGreaterThan(1e-8);
    expect(interval.upper).toBeLessThan(1);
    expect(interval.lower).toBeLessThan(0.5);
    expect(interval.upper).toBeGreaterThan(0.5);
  });

  it('widens as alpha shrinks, down to Number.MIN_VALUE', () => {
    const alphas = [1e-5, 1e-100, 1e-300, 1e-320, Number.MIN_VALUE];
    const widths = alphas.map((alpha) => {
      const interval = clopperPearson(50, 100, alpha);
      return interval.upper - interval.lower;
    });
    for (let i = 1; i < widths.length; i += 1)
      expect(widths[i] as number).toBeGreaterThan(widths[i - 1] as number);
  });

  it('keeps the interval at the usual alpha as it was', () => {
    const interval = clopperPearson(3, 20, 0.05);
    expect(interval.lower).toBeCloseTo(0.0321, 3);
    expect(interval.upper).toBeCloseTo(0.3789, 3);
  });
});

describe('betaQuantileFromLogP', () => {
  it('agrees with betaQuantile where the probability is a double', () => {
    for (const [p, a, b] of [
      [0.9, 3, 4],
      [0.5, 1, 1],
      [0.025, 5, 6],
      [1e-10, 2, 30],
      [0.999, 40, 2],
    ] as const) {
      const expected = betaQuantile(p, a, b);
      expect(Math.abs(betaQuantileFromLogP(Math.log(p), a, b) - expected)).toBeLessThanOrEqual(
        expected * 1e-12,
      );
    }
  });

  it('answers the end of the range for logP of 0 and minus infinity, and refuses NaN', () => {
    expect(betaQuantileFromLogP(0, 2, 3)).toBe(1);
    expect(betaQuantileFromLogP(Number.NEGATIVE_INFINITY, 2, 3)).toBe(0);
    expect(() => betaQuantileFromLogP(Number.NaN, 2, 3)).toThrow(RangeError);
  });

  it('takes a tail below the smallest double without a NaN: exp(-1000) rounds to 0, exp(-740) does not', () => {
    expect(betaQuantileFromLogP(-1000, 1, 1)).toBe(0);
    expect(betaQuantileFromLogP(-740, 1, 1)).toBeCloseTo(Math.exp(-740), 320);
  });
});
