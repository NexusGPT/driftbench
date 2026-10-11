import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as stats from '@driftbench/stats';
import { describe, expect, it } from 'vitest';
import { runLadder } from '../../src/ladder';
import { registeredLadders } from '../../src/ladders/index';
import {
  readDesigns,
  referenceCases,
  referenceLevel,
  STATS_FIXTURES,
  statsLadder,
  WILSON_DRAWS,
  wilsonLevel,
} from '../../src/ladders/stats/index';
import { designsWith, SLOW } from './support';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const fixtures = JSON.parse(readFileSync(new URL(`../../../../${STATS_FIXTURES}`, import.meta.url), 'utf8'));

const LEVELS = [
  'reference-values',
  'wilson-coverage',
  'clustered-coverage',
  'variance-shares',
  'unseen-mass',
  'mde-power',
];

/** The committed designs made small, so a run through every level stays quick. */
const SMALL = designsWith((d) => {
  d.clustered.draws = 120;
  d.clustered.designs = [d.clustered.designs[0] as (typeof d.clustered.designs)[number]];
  d.shares.datasets = 1;
  d.unseen.draws = 20;
  d.unseen.warningDraws = 3;
  d.power.draws = 400;
});

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

describe('the stats ladder', { timeout: SLOW }, () => {
  it(
    'is registered with six levels and reaches level 6 of 6 on the current code',
    async () => {
      const ladder = registeredLadders().stats;
      expect(ladder?.levels.map((level) => level.id)).toEqual(LEVELS);
      expect(ladder?.levels.map((level) => level.direction ?? 'atLeast')).toEqual([
        'atLeast',
        'atLeast',
        'atLeast',
        'atLeast',
        'atMost',
        'atMost',
      ]);
      const run = await runLadder(ladder as NonNullable<typeof ladder>, { seed: 1, root: ROOT });
      expect(run.rows.map((row) => row.pass)).toEqual([true, true, true, true, true, true]);
      expect(run.level).toBe(6);
      expect(run.failing).toBeNull();
    },
    SLOW,
  );

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
    expect(run.rows.slice(1).map((row) => row.pass)).toEqual([null, null, null, null, null]);
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
    const planted = statsLadder({ impl: { wilson: narrow }, designs: SMALL });
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

  it('stops at level 3 when the bootstrap ignores the clusters, and runs nothing above it', async () => {
    // Only on samples larger than any reference case (214 values), so level 1 still passes.
    const ignoring: typeof stats.bootstrapCI = (values, options = {}) =>
      stats.bootstrapCI(values, values.length > 300 ? { ...options, clusters: undefined } : options);
    const run = await runLadder(statsLadder({ impl: { bootstrapCI: ignoring }, designs: SMALL }), {
      seed: 1,
      root: ROOT,
    });
    expect(run.level).toBe(2);
    expect(run.failing?.id).toBe('clustered-coverage');
    expect(run.failing?.items.map((item) => item.id)).toEqual(['clustered-c80x8-rho0.2']);
    expect(run.rows.slice(3).map((row) => row.observed)).toEqual([null, null, null]);
  });

  it('stops at level 6 when the minimum detectable effect ignores the correlation of repeats', async () => {
    // Only on a design no reference case has (n of 80), so level 1 still passes.
    const optimistic: typeof stats.mde = (input) => stats.mde(input.n === 80 ? { ...input, rho: 0 } : input);
    const run = await runLadder(statsLadder({ impl: { mde: optimistic }, designs: SMALL }), {
      seed: 1,
      root: ROOT,
    });
    expect(run.level).toBe(5);
    expect(run.failing?.id).toBe('mde-power');
    expect(run.failing?.items.map((item) => item.id)).toEqual(['power-n80-r3-p0.8']);
  });

  it('refuses a designs file that breaks the schema, naming the file and the field', () => {
    const folder = mkdtempSync(join(tmpdir(), 'v-stats-'));
    const path = join(folder, 'designs.json');
    const broken = designsWith((d) => {
      (d.clustered.designs[0] as { rho: number }).rho = 2;
    });
    writeFileSync(path, JSON.stringify(broken));
    expect(() => readDesigns(path)).toThrow(`${path}: clustered.designs.0.rho`);
  });
});
