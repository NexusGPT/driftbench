import { describe, expect, it } from 'vitest';
import { chiSquareSf, erfc, normalCdf, normalSf } from '../src/index';
import { upperIncompleteGamma } from '../src/special';

describe('special functions at infinite arguments', () => {
  it('normalCdf and normalSf reach their limits', () => {
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(normalSf(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalSf(Number.NEGATIVE_INFINITY)).toBe(1);
  });
  it('erfc reaches 0 and 2', () => {
    expect(erfc(Number.POSITIVE_INFINITY)).toBe(0);
    expect(erfc(Number.NEGATIVE_INFINITY)).toBe(2);
  });
  it('chiSquareSf and upperIncompleteGamma vanish at infinity', () => {
    expect(chiSquareSf(Number.POSITIVE_INFINITY, 3)).toBe(0);
    expect(upperIncompleteGamma(2, Number.POSITIVE_INFINITY)).toBe(0);
  });
  it('NaN stays NaN', () => {
    expect(normalCdf(Number.NaN)).toBeNaN();
  });
});
