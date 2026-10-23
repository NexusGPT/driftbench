import { describe, expect, it } from 'vitest';
import { caseNameFamily } from '../../src/ladders/estate/index';

describe('scan.case against the current components', { timeout: 120_000 }, () => {
  it.each([1, 2, 3])('every item holds on seed %i', async (seed) => {
    const family = caseNameFamily();
    const results = await family.evaluate(seed);
    const failing = family.items.flatMap((item) => {
      const result = results.get(item.id);
      return result?.pass === true ? [] : [`${item.id}: ${result?.detail ?? 'no result'}`];
    });
    expect(failing).toEqual([]);
  });
});
