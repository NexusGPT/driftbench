import { describe, expect, it } from 'vitest';
import { runItem, scratchFolder } from '../../../validators/src/ladders/system/bank';
import { scaleItems } from '../../../validators/src/ladders/system/bank/scale';

describe('teacher-forced history growth', () => {
  it.each([1, 2])(
    'stays within the bank CPU bound from 40 to 400 blocks on seed %i',
    async (seed) => {
      const item = scaleItems().find((entry) => entry.id === 'scale/flow-blocks-teacher-forced/growth');
      if (!item) throw new Error('missing teacher-forced growth item');
      const scratch = scratchFolder();
      try {
        const result = await runItem(item, seed, process.cwd(), scratch.path);
        expect(result.pass, result.pass ? undefined : result.detail).toBe(true);
      } finally {
        scratch.remove();
      }
    },
    60_000,
  );
});
