import { describe, expect, it } from 'vitest';
import * as stats from '../src/index';

// kappaInterval(a, b, { alpha }): Cohen's kappa with se = sqrt(po (1 - po) / (n (1 - pe)^2)) and
// the interval kappa -/+ z se clipped to [-1, 1].
const kappaInterval = (stats as unknown as Record<string, unknown>).kappaInterval as (
  a: readonly (string | number | boolean)[],
  b: readonly (string | number | boolean)[],
  options?: { alpha?: number },
) => { kappa: number; se: number; lower: number; upper: number };

const Z975 = 1.959963984540054;
const Z90 = 1.2815515655446004; // the 0.9 quantile, for alpha = 0.2

describe('kappaInterval', () => {
  it('exists', () => {
    expect(typeof kappaInterval).toBe('function');
  });

  it('matches a hand computation on a binary table', () => {
    // 6 of 8 agree: po = 0.75; both raters say 1 five times of eight: pe = (5/8)^2 + (3/8)^2 = 34/64.
    const a = [1, 1, 0, 0, 1, 0, 1, 1];
    const b = [1, 0, 0, 0, 1, 1, 1, 1];
    const po = 0.75;
    const pe = 34 / 64;
    const kappa = (po - pe) / (1 - pe);
    const se = Math.sqrt((po * (1 - po)) / (8 * (1 - pe) * (1 - pe)));
    const r = kappaInterval(a, b);
    expect(r.kappa).toBeCloseTo(kappa, 12);
    expect(r.se).toBeCloseTo(se, 12);
    expect(r.lower).toBeCloseTo(Math.max(-1, kappa - Z975 * se), 9);
    expect(r.upper).toBe(1); // kappa + z se = 1.1 is clipped to 1
  });

  it('uses alpha for the quantile', () => {
    const a = ['x', 'y', 'x', 'z', 'y', 'x', 'z', 'z', 'y', 'x', 'x', 'y'];
    const b = ['x', 'y', 'y', 'z', 'y', 'x', 'z', 'x', 'y', 'x', 'x', 'z'];
    const r = kappaInterval(a, b, { alpha: 0.2 });
    expect(r.lower).toBeCloseTo(r.kappa - Z90 * r.se, 9);
    expect(r.upper).toBeCloseTo(r.kappa + Z90 * r.se, 9);
  });

  it('gives the point when chance agreement is 1', () => {
    const r = kappaInterval(['a', 'a', 'a'], ['a', 'a', 'a']);
    expect(r.lower).toBe(r.kappa);
    expect(r.upper).toBe(r.kappa);
    expect(Number.isFinite(r.se)).toBe(true);
  });

  it('gives a zero width at perfect agreement', () => {
    const r = kappaInterval([1, 0, 1, 0, 1, 1], [1, 0, 1, 0, 1, 1]);
    expect(r.kappa).toBe(1);
    expect(r.se).toBe(0);
    expect(r.lower).toBe(1);
    expect(r.upper).toBe(1);
  });

  it('clips the lower bound at -1', () => {
    const r = kappaInterval([1, 0, 1, 0], [0, 1, 0, 1]);
    expect(r.kappa).toBe(-1);
    expect(r.lower).toBe(-1);
  });

  it('names the function and the argument on a bad input', () => {
    expect(() => kappaInterval([], [])).toThrowError(/^kappaInterval: a/);
    expect(() => kappaInterval([1, 2], [1])).toThrowError(/^kappaInterval: a or b/);
    expect(() => kappaInterval([1, 0], [1, 0], { alpha: 0 })).toThrowError(/^kappaInterval: alpha/);
  });

  it('does not change its arguments', () => {
    const a = [1, 0, 1, 1];
    const b = [1, 1, 0, 1];
    kappaInterval(a, b);
    expect(a).toEqual([1, 0, 1, 1]);
    expect(b).toEqual([1, 1, 0, 1]);
  });
});
