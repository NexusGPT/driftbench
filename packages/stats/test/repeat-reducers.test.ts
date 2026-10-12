import { describe, expect, it } from 'vitest';
import { parseRepeatReducer, reduceRepeats } from '../src/repeat-reducers';

describe('parseRepeatReducer', () => {
  it('reads the three names a criterion can choose', () => {
    expect(parseRepeatReducer('mode')).toEqual({ kind: 'mode' });
    expect(parseRepeatReducer('median')).toEqual({ kind: 'median' });
    expect(parseRepeatReducer('at_least:3')).toEqual({ kind: 'at_least', k: 3 });
  });

  it('refuses anything else, so a typo never silently changes the verdict', () => {
    expect(() => parseRepeatReducer('majority')).toThrow(RangeError);
    expect(() => parseRepeatReducer('at_least:0')).toThrow(RangeError);
    expect(() => parseRepeatReducer('at_least:x')).toThrow(RangeError);
  });
});

describe('reduceRepeats', () => {
  it('mode takes the most common scored value', () => {
    expect(reduceRepeats([1, 1, 0], { kind: 'mode' })).toBe(1);
    expect(reduceRepeats([0, 0, 1], { kind: 'mode' })).toBe(0);
  });

  it('mode breaks a tie by the value seen first', () => {
    expect(reduceRepeats([0, 1], { kind: 'mode' })).toBe(0);
    expect(reduceRepeats([1, 0], { kind: 'mode' })).toBe(1);
  });

  it('skips inconclusive repeats (undefined) and is undecided when none scored', () => {
    expect(reduceRepeats([undefined, 1, undefined], { kind: 'mode' })).toBe(1);
    expect(reduceRepeats([undefined, undefined], { kind: 'mode' })).toBeUndefined();
  });

  it('median passes above one half, fails below it, and is undecided at exactly one half', () => {
    expect(reduceRepeats([1, 1, 0], { kind: 'median' })).toBe(1);
    expect(reduceRepeats([0, 0, 1], { kind: 'median' })).toBe(0);
    expect(reduceRepeats([0, 1], { kind: 'median' })).toBeUndefined();
  });

  it('median of an even count takes the middle pair', () => {
    expect(reduceRepeats([1, 1, 1, 0], { kind: 'median' })).toBe(1);
    expect(reduceRepeats([0, 0, 0, 1], { kind: 'median' })).toBe(0);
  });

  it('at_least k passes when k repeats pass, and fails otherwise', () => {
    expect(reduceRepeats([1, 1, 0], { kind: 'at_least', k: 2 })).toBe(1);
    expect(reduceRepeats([1, 0, 0], { kind: 'at_least', k: 2 })).toBe(0);
  });

  it('at_least is undecided when fewer than k repeats are scored', () => {
    expect(reduceRepeats([1, undefined, undefined], { kind: 'at_least', k: 2 })).toBeUndefined();
  });
});
