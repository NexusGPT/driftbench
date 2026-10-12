import { describe, expect, it } from 'vitest';
import { positionBias, swapConsistent } from '../src/index';

describe('swapConsistent', () => {
  it('maps the swapped winner back before it compares', () => {
    expect(swapConsistent('a', 'b')).toBe(true);
    expect(swapConsistent('b', 'a')).toBe(true);
    expect(swapConsistent('a', 'a')).toBe(false);
    expect(swapConsistent('b', 'b')).toBe(false);
  });
  it('matches a tie with a tie only', () => {
    expect(swapConsistent('tie', 'tie')).toBe(true);
    expect(swapConsistent('tie', 'a')).toBe(false);
  });
});

describe('positionBias', () => {
  it('is the share of pairs whose winner changes with the swap', () => {
    const pairs = [
      { first: 'a', swapped: 'a' },
      { first: 'a', swapped: 'b' },
      { first: 'b', swapped: 'a' },
      { first: 'tie', swapped: 'tie' },
      { first: 'b', swapped: 'b' },
    ];
    expect(positionBias(pairs)).toBeCloseTo(0.4);
    expect(positionBias([])).toBe(0);
  });
});
