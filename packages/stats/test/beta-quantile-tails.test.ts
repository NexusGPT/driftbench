import { describe, expect, it } from 'vitest';
import { betaQuantile, betaQuantileUpper, clopperPearson, incompleteBeta } from '../src/index';
import reference from './reference/beta-tail.json';

const relative = (got: number, expected: number): number => Math.abs(got - expected) / Math.abs(expected);

describe('betaQuantile in the lower tail', () => {
  it.each(reference.betaQuantile)('betaQuantile($p, $a, $b) matches the 60-digit root', (c) => {
    // The root of I_x(a, b) = p moves by 1 / a times the error of I, so shapes below one need a looser bound.
    expect(relative(betaQuantile(c.p, c.a, c.b), c.expected)).toBeLessThan(c.a < 1 ? 1e-10 : 1e-11);
  });

  it('keeps the round trip for the measured shape (0.0195, 0.324): I(betaQuantile(p)) = p', () => {
    for (const p of [1e-3, 1e-4, 1e-5]) {
      const x = betaQuantile(p, 0.0195, 0.324);
      expect(x).toBeGreaterThan(0);
      expect(relative(incompleteBeta(x, 0.0195, 0.324), p)).toBeLessThan(1e-9);
    }
  });

  it('returns 0 where the root is below the smallest double (p = 1e-10 at shape 0.0195, 0.324)', () => {
    // The root is about 1e-513. On main the search stops at 2^-200 and returns 3.1e-61, whose
    // incompleteBeta is 6.3e-2 instead of 1e-10 (a factor of 6e8).
    expect(betaQuantile(1e-10, 0.0195, 0.324)).toBe(0);
  });
});

describe('betaQuantile above one half', () => {
  const above = reference.betaQuantile.filter((c) => c.p > 0.5 && c.p !== 0.5);

  it.each(above)('betaQuantile($p, $a, $b) keeps the digits of the upper tail', (c) => {
    // p is exact and 1 - p is exact for p of 0.5 and above, so the root is determined to double precision.
    expect(relative(betaQuantile(c.p, c.a, c.b), c.expected)).toBeLessThan(1e-11);
  });

  it('solves p near 1 through the upper tail: the round trip of the upper tail returns 1 - p', () => {
    for (const [p, a, b] of [
      [0.999999999999, 2, 5],
      [0.9999999999, 3, 17],
    ] as const) {
      const x = betaQuantile(p, a, b);
      expect(Math.abs(1 - incompleteBeta(x, a, b) - (1 - p)) / (1 - p)).toBeLessThan(1e-9);
    }
  });
});

describe('betaQuantileUpper and the upper limit of clopperPearson', () => {
  it.each(reference.betaQuantileUpper)('betaQuantileUpper($q, $a, $b) matches the 60-digit root', (c) => {
    expect(relative(betaQuantileUpper(c.q, c.a, c.b), c.expected)).toBeLessThan(1e-10);
  });

  it.each(reference.clopperPearson)('clopperPearson($k, $n, $alpha) matches the 60-digit limits', (c) => {
    const got = clopperPearson(c.k, c.n, c.alpha);
    expect(got.lower === c.lower || relative(got.lower, c.lower) < 1e-10).toBe(true);
    expect(got.upper === c.upper || relative(got.upper, c.upper) < 1e-10).toBe(true);
  });

  it('keeps the measured examples: alpha 1e-20 for 5 of 20 has upper 0.9765331436339714, not 1', () => {
    expect(relative(clopperPearson(5, 20, 1e-20).upper, 0.9765331436339714)).toBeLessThan(1e-12);
  });

  it('betaQuantile above one half agrees with the upper quantile of its complement', () => {
    expect(relative(betaQuantile(0.975, 3, 17), betaQuantileUpper(0.025, 3, 17))).toBeLessThan(1e-12);
  });
});
