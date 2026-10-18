import { describe, expect, it } from 'vitest';
import { bradleyTerry } from '../src/bradley-terry';

describe('bradleyTerry: the maximum likelihood strengths of a round robin', () => {
  it('gives strengths in the ratio of the wins, summing to 1', () => {
    // Player 0 beat player 1 three times, lost once: the strengths are 3 : 1.
    const [a, b] = bradleyTerry([
      [0, 3],
      [1, 0],
    ]);
    expect(a).toBeCloseTo(0.75, 6);
    expect(b).toBeCloseTo(0.25, 6);
  });

  it('refuses a comparison graph that is not strongly connected, where no maximum exists', () => {
    expect(() =>
      bradleyTerry([
        [0, 3, 0, 0],
        [2, 0, 0, 0],
        [0, 0, 0, 1],
        [0, 0, 4, 0],
      ]),
    ).toThrow(RangeError);
  });
});
