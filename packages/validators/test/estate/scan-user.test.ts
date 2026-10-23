import { describe, expect, it } from 'vitest';
import { judgeCase } from '../../src/ladders/estate/bank/hostile';
import { userCases } from '../../src/ladders/estate/bank/scan-user';

describe('the user layer items of bench.defects against the current components', { timeout: 120_000 }, () => {
  it.each([1, 2, 3])('every item holds on seed %i', async (seed) => {
    const failing: string[] = [];
    for (const item of userCases()) {
      const result = await judgeCase(seed, 'bench.defects', item);
      if (!result.pass) failing.push(`${item.key}: ${result.detail}`);
    }
    expect(failing).toEqual([]);
  });
});
