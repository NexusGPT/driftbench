import { describe, expect, it } from 'vitest';
import { findCycles } from '../src/find-cycles';

describe('findCycles: three players who beat each other in a ring', () => {
  it('lists each cycle once, rotated to start at its smallest index', () => {
    // 0 beats 1, 1 beats 2, 2 beats 0 by majority.
    const wins = [
      [0, 2, 0],
      [0, 0, 2],
      [2, 0, 0],
    ];
    expect(findCycles(wins)).toEqual([[0, 1, 2]]);
  });

  it('finds the ring in the other direction too, and lists it once', () => {
    // 0 beats 2, 2 beats 1, 1 beats 0: the same ring read the other way round.
    const wins = [
      [0, 0, 2],
      [2, 0, 0],
      [0, 2, 0],
    ];
    expect(findCycles(wins)).toEqual([[0, 2, 1]]);
  });

  it('finds no cycle when the order is transitive', () => {
    const wins = [
      [0, 2, 2],
      [0, 0, 2],
      [0, 0, 0],
    ];
    expect(findCycles(wins)).toEqual([]);
  });
});
