import { describe, expect, it } from 'vitest';
import { mean, quantile, quantileSorted, sampleVariance } from '../src/index';

/**
 * The degenerate-input contract, rule 1: a RangeError begins `<function>: <argument>`, so the caller sees which
 * argument to fix. A message that names no argument fails this contract.
 */
describe('RangeError names the function and the argument', () => {
  it('mean of an empty sample names values', () => {
    expect(() => mean([])).toThrow(RangeError);
    expect(() => mean([])).toThrow(/^mean: values/);
  });

  it('sampleVariance of an empty sample names values', () => {
    expect(() => sampleVariance([])).toThrow(/^sampleVariance: values/);
  });

  it('quantile of an empty sample names values', () => {
    expect(() => quantile([], 0.5)).toThrow(/^quantile: values/);
  });

  it('quantile level out of range names p', () => {
    expect(() => quantile([1, 2], 2)).toThrow(/^quantile: p/);
  });

  it('quantileSorted of an empty sample names sorted', () => {
    expect(() => quantileSorted([], 0.5)).toThrow(/^quantileSorted: sorted/);
  });
});
