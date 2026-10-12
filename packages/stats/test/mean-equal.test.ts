import { describe, expect, it } from 'vitest';
import { mean } from '../src/index';

describe('mean of equal values', () => {
  it('returns the common value exactly', () => {
    expect(mean(new Array<number>(10).fill(0.6))).toBe(0.6);
    expect(mean(new Array<number>(7).fill(0.1))).toBe(0.1);
    expect(mean([0.3])).toBe(0.3);
  });
  it('keeps the plain average for unequal values', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
});
