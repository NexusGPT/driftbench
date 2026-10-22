import { mulberry32 } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { generator } from '../../src/ladders/stats/draw';

/**
 * The validator draws its inputs from its own copy of mulberry32 (ladders/stats/draw.ts) and does not load the
 * statistics package under test to do it. The copy must stay the same generator as the package's, or every seeded
 * input of the bank changes.
 */
describe('the validator generator', () => {
  it('draws the stream of mulberry32 on the mixed seed, for any seed and salt', () => {
    for (const seed of [0, 1, 2, 977, 4242, 305826193, 4294967295]) {
      for (const salt of [0, 1, 99, 1_000_000, 4_000_017]) {
        const mixed = (Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
        const own = generator(seed, salt);
        const theirs = mulberry32(mixed);
        for (let i = 0; i < 50; i += 1) expect(own()).toBe(theirs());
      }
    }
  });
});
