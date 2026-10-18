import { describe, expect, it } from 'vitest';
import * as stats from '../src/index';

const kishEffectiveSize = (stats as unknown as Record<string, unknown>).kishEffectiveSize as (
  weights: readonly number[],
) => number;

// Kish's effective sample size of weighted units: (sum w)^2 / sum w^2.
describe('kishEffectiveSize', () => {
  it('exists', () => {
    expect(typeof kishEffectiveSize).toBe('function');
  });

  it('matches the documented cases', () => {
    expect(kishEffectiveSize([1, 1, 1, 1])).toBeCloseTo(4, 12);
    expect(kishEffectiveSize([1, 2, 3, 4])).toBeCloseTo(3.3333333333333335, 12);
    expect(kishEffectiveSize([10, 1, 1, 1, 1])).toBeCloseTo(1.8846153846153846, 12);
  });

  it('is the count for equal weights of any size and does not overflow', () => {
    expect(kishEffectiveSize([5, 5, 5])).toBeCloseTo(3, 12);
    expect(kishEffectiveSize([1e200, 1e200, 1e200, 1e200])).toBeCloseTo(4, 12);
  });

  it('does not change its argument and finishes 100000 weights quickly', () => {
    const w = Array.from({ length: 100000 }, (_, i) => 1 + (i % 7));
    const copy = [...w];
    const t = Date.now();
    const r = kishEffectiveSize(w);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(Number.isFinite(r)).toBe(true);
    expect(w).toEqual(copy);
  });

  it('rejects bad input with a RangeError that names the function and the argument', () => {
    expect(() => kishEffectiveSize([])).toThrowError(/^kishEffectiveSize: weights/);
    expect(() => kishEffectiveSize([Number.POSITIVE_INFINITY, 1, 1, 1])).toThrowError(/^kishEffectiveSize: weights/);
    expect(() => kishEffectiveSize([Number.NaN, 1, 1, 1])).toThrowError(/^kishEffectiveSize: weights/);
    expect(() => kishEffectiveSize([1, -1, 1])).toThrowError(/^kishEffectiveSize: weights/);
    expect(() => kishEffectiveSize([0, 0])).toThrowError(/^kishEffectiveSize: weights/);
  });
});
