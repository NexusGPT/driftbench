import { describe, expect, it } from 'vitest';
import { cohenKappa, krippendorffAlpha } from '../src/index';

describe('agreement options outside their set', () => {
  it('krippendorffAlpha refuses an unknown level', () => {
    expect(() => krippendorffAlpha([[1, 2], [1, 2]], { level: 'cubic' as never })).toThrow(RangeError);
  });
  it('cohenKappa refuses unknown weights', () => {
    expect(() => cohenKappa(['a'], ['a'], { weights: 'cubic' as never })).toThrow(RangeError);
  });
  it('the documented options still work', () => {
    for (const level of ['nominal', 'ordinal', 'interval', 'ratio'] as const) {
      expect(krippendorffAlpha([[1, 2, 3], [1, 2, 3]], { level }).alpha).toBeCloseTo(1, 12);
    }
    for (const weights of ['none', 'linear', 'quadratic'] as const) {
      expect(cohenKappa(['a', 'b', 'a'], ['a', 'b', 'a'], { weights }).kappa).toBeCloseTo(1, 12);
    }
  });
});
