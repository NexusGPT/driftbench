import { describe, expect, it } from 'vitest';
import { cusum } from '../src/index';

describe('cusum refuses options that are not finite or out of range', () => {
  it('rejects sd, k, h and target that are NaN, infinite or out of range', () => {
    const x = [1, 2, 3, 2, 1];
    expect(() => cusum(x, { sd: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => cusum(x, { sd: Number.NaN })).toThrow(RangeError);
    expect(() => cusum(x, { sd: 1, k: -0.5 })).toThrow(RangeError);
    expect(() => cusum(x, { sd: 1, k: Number.NaN })).toThrow(RangeError);
    expect(() => cusum(x, { sd: 1, h: Number.NaN })).toThrow(RangeError);
    expect(() => cusum(x, { sd: 1, h: -1 })).toThrow(RangeError);
    expect(() => cusum(x, { sd: 1, target: Number.NaN })).toThrow(RangeError);
  });
  it('still accepts valid options', () => {
    expect(cusum([1, 2, 3], { sd: 1, k: 0, h: 2 }).upper).toHaveLength(3);
  });
});
