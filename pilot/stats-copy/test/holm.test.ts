import { describe, expect, it } from 'vitest';
import * as stats from '../src/index';

type HolmResult = { adjusted: number[]; rejected: boolean[]; alpha: number };
const holm = (stats as unknown as Record<string, unknown>).holm as (
  pvalues: readonly number[],
  alpha?: number,
) => HolmResult;

describe('holm', () => {
  it('exists', () => {
    expect(typeof holm).toBe('function');
  });

  it('matches the textbook step-down adjustment', () => {
    // sorted: 0.01 0.02 0.03 0.04 0.05, m = 5: 5 x .01 = .05, 4 x .02 = .08, 3 x .03 = .09, 2 x .04 = .08, 1 x .05 = .05
    // running maximum: .05 .08 .09 .09 .09
    const r = holm([0.01, 0.02, 0.03, 0.04, 0.05]);
    const want = [0.05, 0.08, 0.09, 0.09, 0.09];
    r.adjusted.forEach((v, i) => expect(v).toBeCloseTo(want[i] as number, 12));
    expect(r.rejected).toEqual([true, false, false, false, false]);
    expect(r.alpha).toBe(0.05);
  });

  it('returns the values in the input order', () => {
    const r = holm([0.04, 0.001, 0.03, 0.2]);
    // sorted 0.001 0.03 0.04 0.2 -> 4 x .001 = .004, 3 x .03 = .09, 2 x .04 = .08 -> max .09, 1 x .2 = .2
    const want = [0.09, 0.004, 0.09, 0.2];
    r.adjusted.forEach((v, i) => expect(v).toBeCloseTo(want[i] as number, 12));
    expect(r.rejected).toEqual([false, true, false, false]);
  });

  it('caps the adjusted value at 1', () => {
    const r = holm([0.5, 0.6, 0.9]);
    expect(r.adjusted).toEqual([1, 1, 1]);
    expect(r.rejected).toEqual([false, false, false]);
  });

  it('is monotone in the rank and gives tied values the same adjustment', () => {
    const r = holm([0.02, 0.02, 0.02, 0.9]);
    expect(r.adjusted[0]).toBeCloseTo(0.08, 12);
    expect(r.adjusted[1]).toBeCloseTo(0.08, 12);
    expect(r.adjusted[2]).toBeCloseTo(0.08, 12);
    expect(r.adjusted[3]).toBe(0.9);
  });

  it('uses the alpha given', () => {
    const r = holm([0.01, 0.02, 0.03], 0.1);
    expect(r.alpha).toBe(0.1);
    expect(r.rejected).toEqual([true, true, true]);
  });

  it('handles one and no hypotheses', () => {
    expect(holm([0.03]).adjusted).toEqual([0.03]);
    expect(holm([0.03]).rejected).toEqual([true]);
    expect(holm([])).toEqual({ adjusted: [], rejected: [], alpha: 0.05 });
  });

  it('names the function and the argument on a bad input and leaves the input alone', () => {
    expect(() => holm([0.1, 1.5])).toThrowError(/^holm: pvalues/);
    expect(() => holm([0.1, Number.NaN])).toThrowError(/^holm: pvalues/);
    expect(() => holm([0.1], 0)).toThrowError(/^holm: alpha/);
    const p = [0.3, 0.1, 0.2];
    holm(p);
    expect(p).toEqual([0.3, 0.1, 0.2]);
  });
});
