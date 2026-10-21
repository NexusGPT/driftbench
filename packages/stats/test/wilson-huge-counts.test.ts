import { describe, expect, it } from 'vitest';
import { wilson, Z95 } from '../src/index';

// A count above about 1.3e154 squared to infinity in the half-width, which became 0 while the centre stayed above 0:
// the interval then excluded its own estimate. These totals are finite, exactly represented integers.
const TOTALS = [2 ** 512, 2 ** 600, 2 ** 900];
const Z2 = Z95 * Z95;

describe('wilson at counts too large to square', () => {
  it.each(TOTALS)('holds zero successes of %e trials from 0 to z^2 / (n + z^2)', (n) => {
    const { estimate, lower, upper } = wilson(0, n);
    expect(estimate).toBe(0);
    expect(lower).toBe(0);
    expect(upper / (Z2 / n)).toBeCloseTo(1, 12);
  });

  it.each(TOTALS)('holds all of %e trials from 1 - z^2 / n to 1', (n) => {
    const { estimate, lower, upper } = wilson(n, n);
    expect(estimate).toBe(1);
    expect(upper).toBe(1);
    expect(lower).toBeGreaterThan(1 - 1e-9);
    expect(lower).toBeLessThanOrEqual(1);
  });

  it.each(TOTALS)('holds one success of %e trials around 1 / n, above 0', (n) => {
    const { estimate, lower, upper } = wilson(1, n);
    expect(lower).toBeGreaterThanOrEqual(0);
    expect(lower).toBeLessThanOrEqual(estimate);
    expect(upper).toBeGreaterThanOrEqual(estimate);
    expect(upper).toBeGreaterThan(lower);
    expect(Number.isFinite(upper)).toBe(true);
  });

  it('keeps the interval of an ordinary count identical to the original expression, bit for bit', () => {
    // The scaled form applies only where 4 * n * n is infinite. This is the expression before the change.
    const original = (k: number, n: number) => {
      const p = k / n;
      const denom = 1 + Z2 / n;
      const center = (p + Z2 / (2 * n)) / denom;
      const half = (Z95 / denom) * Math.sqrt((p * (1 - p)) / n + Z2 / (4 * n * n));
      return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
    };
    for (const [k, n] of [
      [0, 1],
      [1, 1],
      [7, 50],
      [25, 50],
      [333, 1000],
      [0, 20],
      [1000, 1000],
      [123456, 7654321],
      [1, 1e150],
    ] as const) {
      const got = wilson(k, n);
      const want = original(k, n);
      // Next to 1 the lower bound is one minus its distance to 1, a sum of positive terms, and a bound at the
      // count is exactly 1 (the weights.near-one and weights.mirror items); every other bound is the original.
      const nearOne = 1 - (2 * (n - k) + Z2 + Z95 * Math.sqrt(Z2 + (4 * k * (n - k)) / n)) / (2 * (n + Z2));
      expect(got.lower, `lower of ${k} of ${n}`).toBe(2 * k > n ? nearOne : want.lower);
      expect(got.upper, `upper of ${k} of ${n}`).toBe(k === n ? 1 : want.upper);
    }
  });
});
