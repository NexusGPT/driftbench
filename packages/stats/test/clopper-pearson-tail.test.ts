import { describe, expect, it } from 'vitest';
import { clopperPearson } from '../src/intervals';
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
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * 1e-11);
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
