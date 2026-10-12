import { describe, expect, it } from 'vitest';
import { wilcoxonSignedRank } from '../src/index';

describe('wilcoxonSignedRank refuses non-finite data', () => {
  for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    it(`rejects ${v} in either sample`, () => {
      const x = [0.4, v, 0.1, 0.5, 0.2, 0.3];
      const y = [0.3, 0.2, 0.2, 0.4, 0.1, 0.5];
      expect(() => wilcoxonSignedRank(x, y)).toThrow(RangeError);
      expect(() => wilcoxonSignedRank(y, x)).toThrow(RangeError);
    });
  }
  it('still ranks finite pairs', () => {
    expect(wilcoxonSignedRank([1, 2, 3, 4], [0.5, 1, 1, 1]).n).toBe(4);
  });
});
