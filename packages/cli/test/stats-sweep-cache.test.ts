import { defineLadder, runSeeds } from '@agent-nexus/driftbench-validators';
import { describe, expect, it } from 'vitest';
import { createStatsMeasurementCache } from '../src/commands/stats-sweep-cache';

function fixture(component = 'stats') {
  let calls = 0;
  const ladder = defineLadder({
    component,
    version: 1,
    levels: [
      {
        id: 'one',
        name: 'one',
        metric: 'seed',
        threshold: 0,
        direction: 'atLeast',
        compute: async ({ seed }) => {
          calls += 1;
          return { value: seed, items: [] };
        },
      },
    ],
  });
  return { ladder, calls: () => calls };
}

describe('stats measurements within one sweep', () => {
  it('keeps floor-capped and uncapped measurements in separate entries', async () => {
    const f = fixture();
    const cache = createStatsMeasurementCache(() => 'same');
    const seeds = [{ seed: 1, hidden: false }];
    const capped = { full: false, maxLevel: 1 };
    await cache.run(f.ladder, seeds, '/fixture');
    await cache.run(f.ladder, seeds, '/fixture', capped);
    await cache.run(f.ladder, seeds, '/fixture', capped);
    expect(f.calls()).toBe(2);
  });

  it('reuses each stats revision and seed and matches a fresh result exactly', async () => {
    const f = fixture();
    const cache = createStatsMeasurementCache(() => 'stats-commit-1');
    const seeds = [{ seed: 1, hidden: false }];
    const first = await cache.run(f.ladder, seeds, '/fixture');
    const cached = await cache.run(f.ladder, seeds, '/fixture');
    expect(f.calls()).toBe(1);
    const fresh = await runSeeds(f.ladder, seeds, '/fixture');
    expect(cached).toEqual(fresh);
    expect(cached).toEqual(first);
    const cachedSeed = cached.seeds[0];
    if (!cachedSeed) throw new Error('missing cached seed');
    cachedSeed.level = 99;
    expect(await cache.run(f.ladder, seeds, '/fixture')).toEqual(fresh);
  });

  it('invalidates when the stats commit, seed, root or full-run mode changes', async () => {
    const f = fixture();
    let revision = 'stats-commit-1';
    const cache = createStatsMeasurementCache(() => revision);
    const seed1 = [{ seed: 1, hidden: false }];
    await cache.run(f.ladder, seed1, '/fixture');
    await cache.run(f.ladder, [{ seed: 2, hidden: false }], '/fixture');
    await cache.run(f.ladder, seed1, '/other');
    await cache.run(f.ladder, seed1, '/fixture', { full: true });
    revision = 'stats-commit-2';
    await cache.run(f.ladder, seed1, '/fixture');
    expect(f.calls()).toBe(5);
  });

  it('shares seed 1 between a single-seed request and a range', async () => {
    const f = fixture();
    const cache = createStatsMeasurementCache(() => 'stats-commit-1');
    await cache.run(f.ladder, [{ seed: 1, hidden: false }], '/fixture');
    const range = await cache.run(
      f.ladder,
      [1, 2, 3].map((seed) => ({ seed, hidden: false })),
      '/fixture',
    );
    expect(range.seeds.map((run) => run.seed)).toEqual([1, 2, 3]);
    expect(f.calls()).toBe(3);
  });

  it('runs fresh in a new sweep, with dirty code, or for another component', async () => {
    const f = fixture();
    const seed = [{ seed: 1, hidden: false }];
    await createStatsMeasurementCache(() => 'same').run(f.ladder, seed, '/fixture');
    await createStatsMeasurementCache(() => 'same').run(f.ladder, seed, '/fixture');
    const dirty = createStatsMeasurementCache(() => undefined);
    await dirty.run(f.ladder, seed, '/fixture');
    await dirty.run(f.ladder, seed, '/fixture');
    expect(f.calls()).toBe(4);
    const other = fixture('system');
    const cache = createStatsMeasurementCache(() => 'same');
    await cache.run(other.ladder, seed, '/fixture');
    await cache.run(other.ladder, seed, '/fixture');
    expect(other.calls()).toBe(2);
  });
});
