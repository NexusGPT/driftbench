import { describe, expect, it } from 'vitest';
import { swapConsistent } from '../src/index';

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
