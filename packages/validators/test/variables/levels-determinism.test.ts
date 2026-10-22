import { describe, expect, it } from 'vitest';
import { runInProcess } from '../../src/ladders/variables/bank/index';
import { blindBank } from '../../src/ladders/variables/blind/index';
import { referenceImpl } from '../variables-blind/reference/index';

/**
 * A level opens only when every item before it passes (levels-lock.test.ts), so one item that answers differently
 * on two runs of the same seed and the same product would lock or unlock every level after it by chance. Every item
 * must give the same verdict, and the same detail, on two runs in one process.
 */
describe('every item gives the same result on two runs of one seed and one product', () => {
  const items = blindBank().filter((item) => item.family !== 'scale');

  it('agrees on seeds 1 and 2', async () => {
    for (const seed of [1, 2]) {
      const first = await runInProcess(items, seed, '/nonexistent', referenceImpl);
      const second = await runInProcess(items, seed, '/nonexistent', referenceImpl);
      const different = items
        .filter((item) => {
          const a = first.get(item.id);
          const b = second.get(item.id);
          return a?.pass !== b?.pass || a?.detail !== b?.detail;
        })
        .map((item) => `${item.id}: ${first.get(item.id)?.detail} | ${second.get(item.id)?.detail}`);
      expect(different, `seed ${seed}`).toEqual([]);
    }
  }, 300_000);
});
