import { describe, expect, it } from 'vitest';
import { decode, encode } from '../../src/frame/tape';

describe('an error crosses the frame with its class and its code', () => {
  it('keeps a RangeError and its string code as fields', () => {
    const error = Object.assign(new RangeError('any words'), { code: 'VARIABLES_WEIGHT_ZERO' });
    const back = decode(encode(error)) as Error & { code?: unknown };
    expect(back).toBeInstanceOf(RangeError);
    expect(back.code).toBe('VARIABLES_WEIGHT_ZERO');
    expect(back.message).toBe('any words');
  });

  it('keeps a plain Error plain, and drops a code that is not a string or a number', () => {
    const back = decode(encode(Object.assign(new Error('x'), { code: { nested: true } }))) as Error & {
      code?: unknown;
    };
    expect(back).not.toBeInstanceOf(RangeError);
    expect(back.code).toBeUndefined();
  });
});
