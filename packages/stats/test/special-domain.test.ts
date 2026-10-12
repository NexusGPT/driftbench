import { describe, expect, it } from 'vitest';
import { betaQuantile, chiSquareSf, incompleteBeta, logGamma } from '../src/index';

const refusesOrNaN = (f: () => number): boolean => {
  try {
    return Number.isNaN(f());
  } catch (e) {
    return e instanceof RangeError;
  }
};

describe('special functions outside their domain', () => {
  it('logGamma is infinite at the poles 0, -1, -2', () => {
    expect(logGamma(-2)).toBe(Number.POSITIVE_INFINITY);
    expect(logGamma(0)).toBe(Number.POSITIVE_INFINITY);
    expect(logGamma(-1)).toBe(Number.POSITIVE_INFINITY);
  });
  it('logGamma keeps its value between the poles', () => {
    expect(logGamma(-0.5)).toBeCloseTo(1.2655121234846454, 12);
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 12);
  });
  it('chiSquareSf refuses zero degrees of freedom', () => {
    expect(refusesOrNaN(() => chiSquareSf(2, 0))).toBe(true);
    expect(refusesOrNaN(() => chiSquareSf(2, -1))).toBe(true);
  });
  it('incompleteBeta refuses x outside [0, 1] and bad shapes', () => {
    expect(refusesOrNaN(() => incompleteBeta(1.5, 2, 3))).toBe(true);
    expect(refusesOrNaN(() => incompleteBeta(-0.5, 2, 3))).toBe(true);
    expect(refusesOrNaN(() => incompleteBeta(0.5, 0, 3))).toBe(true);
  });
  it('betaQuantile refuses a NaN or out-of-range probability', () => {
    expect(refusesOrNaN(() => betaQuantile(Number.NaN, 2, 3))).toBe(true);
    expect(refusesOrNaN(() => betaQuantile(1.5, 2, 3))).toBe(true);
  });
});
