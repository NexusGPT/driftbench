import { describe, expect, it } from 'vitest';
import { pageHinkley } from '../src/index';

describe('pageHinkley refuses degenerate input', () => {
  it('rejects an empty series', () => {
    expect(() => pageHinkley([])).toThrow(RangeError);
  });
  it('rejects non-finite data', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => pageHinkley([0.4, 0.2, v, 0.6])).toThrow(RangeError);
    }
  });
  it('rejects a negative or non-finite threshold and delta', () => {
    expect(() => pageHinkley([1, 2, 3], { threshold: -1 })).toThrow(RangeError);
    expect(() => pageHinkley([1, 2, 3], { threshold: Number.NaN })).toThrow(RangeError);
    expect(() => pageHinkley([1, 2, 3], { delta: Number.NaN })).toThrow(RangeError);
    expect(() => pageHinkley([1, 2, 3], { delta: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
  it('still accepts the defaults', () => {
    expect(pageHinkley([1, 2, 3]).up).toHaveLength(3);
  });
});
