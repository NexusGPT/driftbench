import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as stats from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { analyticItems } from '../../src/ladders/stats/bank/analytic';
import { runItem } from '../../src/ladders/stats/bank/index';
import { referenceItems } from '../../src/ladders/stats/bank/reference';
import { hiddenSeed } from '../../src/seeds';
import { ROOT } from './support';

const ids = [
  ...['s20-even', 's40-tail5', 's80-tail10'].map(
    (population) => `analytic.unseen.chao1-near.${population}.x1.5`,
  ),
  'analytic.unseen.chao1-near.s20-even.x3',
];
const items = analyticItems().filter((item) => ids.includes(item.id));

// The statistics page binds functions to the pinned Python fixtures. Those select the
// finite-sample classic form, with the documented zero-doubleton fallback, not iChao1.
function classic(counts: readonly number[]) {
  const n = counts.reduce((sum, count) => sum + count, 0);
  const observed = counts.filter((count) => count > 0).length;
  const singletons = counts.filter((count) => count === 1).length;
  const doubletons = counts.filter((count) => count === 2).length;
  const unseen = doubletons > 0 ? singletons ** 2 / (2 * doubletons) : (singletons * (singletons - 1)) / 2;
  return observed + (1 - 1 / n) * unseen;
}
const classicImplementation = {
  ...stats,
  chaoCoverage: (counts: readonly number[]) => ({ ...stats.chaoCoverage(counts), chao1: classic(counts) }),
};

describe('classic Chao1 is one contract for the reference and analytic bank', () => {
  it('retains precisely the four item identities', () => {
    expect(items.map((item) => item.id).sort()).toEqual([...ids].sort());
  });

  it('the pinned fixtures select the classic finite-sample formula and zero-doubleton fallback', () => {
    const fixtures = JSON.parse(
      readFileSync(join(ROOT, 'packages/stats/test/reference/fixtures.json'), 'utf8'),
    ) as {
      coverage: { counts: number[]; chao1: number; f2: number }[];
    };
    expect(fixtures.coverage.some((row) => row.f2 === 0)).toBe(true);
    expect(fixtures.coverage.some((row) => row.f2 > 0)).toBe(true);
    for (const row of fixtures.coverage) expect(classic(row.counts)).toBeCloseTo(row.chao1, 12);
  });

  it('the same classic implementation passes the pinned coverage reference item', async () => {
    const item = referenceItems().find((item) => item.id === 'reference.coverage.coverage');
    expect(item).toBeDefined();
    if (!item) throw new Error('missing reference coverage item');
    expect((await runItem(item, 1, ROOT, classicImplementation)).pass).toBe(true);
  });

  it('the pinned reference rejects a broken zero-doubleton fallback', async () => {
    const item = referenceItems().find((item) => item.id === 'reference.coverage.coverage');
    if (!item) throw new Error('missing reference coverage item');
    const wrong = {
      ...stats,
      chaoCoverage: (counts: readonly number[]) => {
        const actual = stats.chaoCoverage(counts);
        return { ...actual, chao1: actual.f2 === 0 ? actual.chao1 + 1 : actual.chao1 };
      },
    };
    expect((await runItem(item, 1, ROOT, wrong)).pass).toBe(false);
  });

  it('holds on the executor sweep hidden seed for s20-even x3', async () => {
    const item = items.find((item) => item.id === 'analytic.unseen.chao1-near.s20-even.x3');
    if (!item) throw new Error('missing s20-even x3 item');
    // Read-only exec/stats-v3 HANDOVER.md records the failing sweep at this commit.
    const seed = hiddenSeed(ROOT, () => '4867887a1d6f14ac2741a9535b078f246cbdb1a3').seed;
    expect(await runItem(item, seed, ROOT, classicImplementation)).toMatchObject({ pass: true });
  });

  for (const item of items) {
    it(`holds on the pinned estimator: ${item.id}`, async () => {
      for (let seed = 1; seed <= 20; seed += 1)
        expect(await runItem(item, seed, ROOT, classicImplementation)).toMatchObject({ pass: true });
    });

    it(`holds on the current commit hidden seed: ${item.id}`, async () => {
      expect(await runItem(item, hiddenSeed(ROOT).seed, ROOT, classicImplementation)).toMatchObject({
        pass: true,
      });
    });

    it(`rejects an oracle returning the planted true class count: ${item.id}`, async () => {
      const wrong = {
        ...stats,
        chaoCoverage: (counts: readonly number[]) => ({
          ...stats.chaoCoverage(counts),
          chao1: counts.length,
        }),
      };
      const result = await runItem(item, 1, ROOT, wrong);
      expect(result.pass).toBe(false);
      expect(result.detail).toContain('expected classic Chao1');
    });

    it(`rejects a substituted bias-corrected estimator: ${item.id}`, async () => {
      const wrong = {
        ...stats,
        chaoCoverage: (counts: readonly number[]) => {
          const actual = stats.chaoCoverage(counts);
          return {
            ...actual,
            chao1:
              actual.observed + ((1 - 1 / actual.n) * actual.f1 * (actual.f1 - 1)) / (2 * (actual.f2 + 1)),
          };
        },
      };
      const result = await runItem(item, 1, ROOT, wrong);
      expect(result.pass).toBe(false);
      expect(result.detail).toContain('chaoCoverage');
    });
  }
});
