import { describe, expect, it } from 'vitest';
import * as stats from '../src/index';

type MidP = { pValue: number; b: number; c: number };
const mcnemarMidP = (stats as unknown as Record<string, unknown>).mcnemarMidP as (b: number, c: number) => MidP;

// mid-p = 2 P(X < k) + P(X = k), capped at 1, X ~ Binomial(b + c, 0.5), k = min(b, c).
describe('mcnemarMidP', () => {
  it('exists', () => {
    expect(typeof mcnemarMidP).toBe('function');
  });

  it('gives 0.03125 for five discordant pairs all one way', () => {
    const r = mcnemarMidP(5, 0);
    expect(r.pValue).toBeCloseTo(1 / 32, 14);
    expect(r.b).toBe(5);
    expect(r.c).toBe(0);
  });

  it('matches a hand computation', () => {
    // n = 10, k = 2: P(X < 2) = 11 / 1024, P(X = 2) = 45 / 1024
    expect(mcnemarMidP(2, 8).pValue).toBeCloseTo(67 / 1024, 14);
  });

  it('is symmetric in b and c', () => {
    expect(mcnemarMidP(3, 9).pValue).toBeCloseTo(mcnemarMidP(9, 3).pValue, 14);
  });

  it('is below the exact test at small counts', () => {
    const exact = stats.mcnemar(2, 8, { exact: true }).pValue;
    expect(mcnemarMidP(2, 8).pValue).toBeLessThan(exact);
  });

  it('gives 1 for tied sides and for no discordant pair', () => {
    expect(mcnemarMidP(10, 10).pValue).toBe(1);
    expect(mcnemarMidP(0, 0).pValue).toBe(1);
  });

  it('stays finite and in [0, 1] on large counts', () => {
    const r = mcnemarMidP(48_000, 52_000);
    expect(r.pValue).toBeGreaterThan(0);
    expect(r.pValue).toBeLessThanOrEqual(1);
    expect(Number.isFinite(r.pValue)).toBe(true);
  });

  it('names the function and the argument on a bad count', () => {
    expect(() => mcnemarMidP(-1, 3)).toThrowError(/^mcnemarMidP: b/);
    expect(() => mcnemarMidP(3, 1.5)).toThrowError(/^mcnemarMidP: c/);
    expect(() => mcnemarMidP(Number.NaN, 3)).toThrowError(/^mcnemarMidP: b/);
  });
});
