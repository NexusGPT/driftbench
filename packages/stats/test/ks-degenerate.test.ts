import { describe, expect, it } from 'vitest';
import { ksTest } from '../src/index';

describe('ksTest refuses degenerate input', () => {
  it('rejects infinite data', () => {
    expect(() => ksTest([0.1, Number.POSITIVE_INFINITY, 0.3], [0.2, 0.4])).toThrow(RangeError);
    expect(() => ksTest([0.1, 0.2], [Number.NEGATIVE_INFINITY, 0.4, 0.5])).toThrow(RangeError);
  });
  it('rejects an unknown method', () => {
    expect(() => ksTest([1, 2], [3, 4], { method: 'magic' as never })).toThrow(RangeError);
  });
  it('rejects NaN data instead of looping forever', () => {
    expect(() => ksTest([0.1, Number.NaN, 0.3], [0.2, 0.4])).toThrow(RangeError);
  });
  it('still accepts the three documented methods', () => {
    for (const method of ['auto', 'exact', 'asymptotic'] as const) {
      expect(ksTest([1, 2, 3], [2.5, 3.5, 4.5], { method }).statistic).toBeGreaterThan(0);
    }
  });
});
