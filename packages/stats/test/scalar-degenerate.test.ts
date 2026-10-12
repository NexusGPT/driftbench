import { describe, expect, it } from 'vitest';
import {
  designEffect,
  effectiveSampleSize,
  hillNumber,
  mde,
  neymanAllocation,
  repeatsForFloor,
  wilson,
} from '../src/index';

const inf = Number.POSITIVE_INFINITY;
const nan = Number.NaN;

describe('scalar arguments must be finite', () => {
  it('wilson refuses a NaN or negative z', () => {
    expect(() => wilson(3, 10, nan)).toThrow(RangeError);
    expect(() => wilson(2, 10, -1.96)).toThrow(RangeError);
    expect(wilson(2, 10, 1.96).lower).toBeLessThan(0.2);
  });
  it('designEffect and effectiveSampleSize refuse infinite or NaN sizes', () => {
    expect(() => designEffect(inf, 0.1)).toThrow(RangeError);
    expect(() => effectiveSampleSize(inf, 4, 0.1)).toThrow(RangeError);
    expect(() => effectiveSampleSize(nan, 4, 0.1)).toThrow(RangeError);
    expect(effectiveSampleSize(100, 4, 0.1)).toBeCloseTo(100 / 1.3, 12);
  });
  it('mde refuses infinite n and repeats', () => {
    expect(() => mde({ n: inf, baselineRate: 0.8 })).toThrow(RangeError);
    expect(() => mde({ n: 50, repeats: inf, baselineRate: 0.8 })).toThrow(RangeError);
  });
  it('repeatsForFloor refuses infinite variance, floor and blocks', () => {
    expect(() => repeatsForFloor({ variance: inf, floor: 0.05 })).toThrow(RangeError);
    expect(() => repeatsForFloor({ variance: 0.2, floor: 0.05, blocks: inf })).toThrow(RangeError);
    expect(() => repeatsForFloor({ variance: 0.2, floor: inf })).toThrow(RangeError);
  });
  it('neymanAllocation refuses infinite sizes and sds', () => {
    expect(() => neymanAllocation({ sizes: [10, inf], sds: [1, 1], total: 10 })).toThrow(RangeError);
    expect(() => neymanAllocation({ sizes: [10, 10], sds: [1, inf], total: 10 })).toThrow(RangeError);
  });
  it('hillNumber refuses a NaN order', () => {
    expect(() => hillNumber([3, 2, 1], nan)).toThrow(RangeError);
    expect(hillNumber([3, 2, 1], 0)).toBe(3);
  });
});
