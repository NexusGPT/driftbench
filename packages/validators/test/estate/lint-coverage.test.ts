import { describe, expect, it } from 'vitest';
import { lintCoverageFamily } from '../../src/ladders/estate/bank/coverage';
import { estateBank } from '../../src/ladders/estate/bank/index';

/**
 * The lint.coverage family of the estate bank: every item passes on two seeds. Each item fails on a build that
 * does not list the files no part type covers, summarises a lint with an unknown file as clean, or counts a check
 * with no input as a pass.
 */
describe('the lint.coverage family', () => {
  it('is in the bank at the lint level, with at least 20 items over at least four tiers', () => {
    const family = estateBank().find((candidate) => candidate.id === 'lint.coverage');
    expect(family?.level).toBe(2);
    expect(family?.items.length).toBeGreaterThanOrEqual(20);
    expect(new Set(family?.items.map((item) => item.tier)).size).toBeGreaterThanOrEqual(4);
  });

  it.each([1, 2])('passes every item on seed %i', async (seed) => {
    const results = await lintCoverageFamily().evaluate(seed);
    const failing = [...results]
      .filter(([, result]) => !result.pass)
      .map(([id, result]) => `${id}: ${result.detail}`);
    expect(failing).toEqual([]);
    expect(results.size).toBe(lintCoverageFamily().items.length);
  });
});
