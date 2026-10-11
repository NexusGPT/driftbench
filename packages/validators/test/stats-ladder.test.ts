import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as stats from '@driftbench/stats';
import { describe, expect, it } from 'vitest';
import {
  referenceCases,
  referenceLevel,
  registeredLadders,
  runLadder,
  STATS_FIXTURES,
  statsLadder,
  WILSON_DRAWS,
  wilsonLevel,
} from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const fixtures = JSON.parse(readFileSync(new URL(`../../../${STATS_FIXTURES}`, import.meta.url), 'utf8'));

/** Every reference case in the fixtures file, counted from the file itself. */
function fixtureCount(): number {
  const list = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
  let count = 0;
  for (const group of ['special', 'intervals', 'reliability', 'paired', 'drift']) {
    for (const value of Object.values(fixtures[group])) count += list(value);
  }
  count += list(fixtures.bootstrap.replay) + 1;
  for (const group of [
    'mcnemar',
    'wilcoxon',
    'benjaminiHochberg',
    'mde',
    'kappa',
    'krippendorff',
    'varianceComponents',
    'neyman',
    'repeatsForFloor',
    'coverage',
  ])
    count += list(fixtures[group]);
  return count;
}

describe('the stats ladder', () => {
  it('is registered and reaches level 2 of 2 on the current code', async () => {
    const ladder = registeredLadders().stats;
    expect(ladder?.levels.map((level) => level.id)).toEqual(['reference-values', 'wilson-coverage']);
    const run = await runLadder(ladder as NonNullable<typeof ladder>, { seed: 1, root: ROOT });
    expect(run.rows.map((row) => [row.observed !== null && row.observed >= row.threshold, row.pass])).toEqual(
      [
        [true, true],
        [true, true],
      ],
    );
    expect(run.level).toBe(2);
  });

  it('compares every reference case of the fixtures file', () => {
    expect(referenceCases(fixtures, stats)).toHaveLength(fixtureCount());
    expect(referenceLevel(fixtures, stats)).toEqual({ value: 1, items: [] });
  });

  it('names the fixture and the source file of a planted fault at level 1, and stops there', async () => {
    const planted = statsLadder({
      impl: { logGamma: (x: number) => (x === 7 ? stats.logGamma(x) + 1e-4 : stats.logGamma(x)) },
    });
    const run = await runLadder(planted, { seed: 1, root: ROOT });
    expect(run.level).toBe(0);
    expect(run.rows[1]?.pass).toBeNull();
    expect(run.failing?.items).toHaveLength(1);
    expect(run.failing?.items[0]).toMatchObject({
      id: 'special.logGamma[3]',
      component: 'packages/stats/src/special.ts',
    });
    expect(run.failing?.items[0]?.detail).toMatch(
      /^logGamma\(7\): got 6\.57935\d+, expected 6\.579251212010101 \(diff 1\.00e-4, tolerance 1e-6\)$/,
    );
  });

  it('fails level 2 when the default Wilson interval is too narrow, naming each sample size', async () => {
    const narrow = (k: number, n: number, z?: number) => stats.wilson(k, n, z ?? 1.6);
    const planted = statsLadder({ impl: { wilson: narrow } });
    const run = await runLadder(planted, { seed: 1, root: ROOT });
    expect(run.level).toBe(1);
    expect(run.failing?.id).toBe('wilson-coverage');
    expect(run.failing?.items.map((item) => item.id)).toEqual(['wilson-n20', 'wilson-n50', 'wilson-n200']);
    expect(run.failing?.items[0]?.detail).toMatch(
      new RegExp(`^estimator wilson, seed 1, n 20: \\d+ of ${WILSON_DRAWS} intervals contain the truth`),
    );
    expect(run.failing?.items[0]?.detail).toMatch(
      /first misses: draw \d+: truth [\d.]+, estimate [\d.]+, interval \[/,
    );
  });

  it('draws differently on each seed and the same on a repeat', () => {
    const a = wilsonLevel(1, stats);
    expect(wilsonLevel(1, stats)).toEqual(a);
    expect(wilsonLevel(2, stats).value).not.toBe(a.value);
  });
});
