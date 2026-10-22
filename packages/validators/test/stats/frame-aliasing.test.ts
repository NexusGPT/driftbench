import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { statsBank } from '../../src/ladders/stats/bank/index';
import { runIsolated } from '../../src/ladders/stats/bank/isolate';
import { findRoot } from '../../src/root';
import { type Aliasing, aliasingPackage } from './fixtures/frame-aliasing/build';

/**
 * Items that keep the result of one call across the next call of the package (the shifted bootstrap items read
 * the first interval after the second call) reject a package that reuses one result object, or overwrites the
 * earlier result on the next call. The frame sends results across the process boundary as data, so the item
 * cannot see the aliasing any more; the confined runs check their own live results instead
 * (docs/validators.md section 12.9, "Aliased results") and the item fails on what they report.
 */

vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });

const ROOT = findRoot(process.cwd());
const SEEDS = [1, 2, 3];
const ids = ['stability.bootstrap-shift-1000000', 'stability.bootstrap-shift-1000000000'];
const items = statsBank(ROOT).filter((item) => ids.includes(item.id));
mkdirSync(join(ROOT, 'node_modules', '.cache'), { recursive: true });
const work = mkdtempSync(join(ROOT, 'node_modules', '.cache', 'frame-aliasing-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** The outcome of the two items on each seed, when the bank child tests the package built as `kind`. */
async function outcomes(kind: Aliasing): Promise<Array<{ seed: number; id: string; pass: boolean }>> {
  const index = aliasingPackage(ROOT, kind, join(work, kind));
  const before = process.env.DRIFTBENCH_STATS_IMPL;
  process.env.DRIFTBENCH_STATS_IMPL = index;
  try {
    const out: Array<{ seed: number; id: string; pass: boolean }> = [];
    for (const seed of SEEDS) {
      const run = await runIsolated(items, seed, ROOT);
      for (const item of items) out.push({ seed, id: item.id, pass: run.get(item.id)?.pass === true });
    }
    return out;
  } finally {
    if (before === undefined) delete process.env.DRIFTBENCH_STATS_IMPL;
    else process.env.DRIFTBENCH_STATS_IMPL = before;
  }
}

describe('the shifted bootstrap items under the frame', () => {
  it('pass a package that returns a new object on every call', async () => {
    expect((await outcomes('fresh')).filter((each) => !each.pass)).toEqual([]);
  });

  it('fail a package that fills one shared result object on every call', async () => {
    expect((await outcomes('shared')).filter((each) => each.pass)).toEqual([]);
  });

  it('fail a package that overwrites the earlier result on the next call', async () => {
    expect((await outcomes('overwrite')).filter((each) => each.pass)).toEqual([]);
  });

  // A package that blinds the watch's own intrinsics (the hash, the serialiser, Reflect) at load is still caught: the
  // driver captures what it uses before the product loads (review of PR 986, codex run 39709007729).
  it.each(['patch-digest', 'patch-update', 'patch-stringify', 'patch-reflect'] as const)(
    'fail a padded shared-object package that patches %s',
    async (kind) => {
      expect((await outcomes(kind)).filter((each) => each.pass)).toEqual([]);
    },
  );

  // A result that is a Proxy, or holds one, is an invalid result: the watch cannot read it without running the
  // product's own code, and the product could answer it otherwise on later reads.
  it.each(['proxy', 'proxy-nested'] as const)(
    'fail a package that returns a result with a Proxy (%s)',
    async (kind) => {
      expect((await outcomes(kind)).filter((each) => each.pass)).toEqual([]);
    },
  );

  // A result that holds an accessor property (a getter or a setter) is an invalid result too: reading it runs the
  // product's own code, and it could answer otherwise on later reads.
  it.each(['getter', 'setter'] as const)(
    'fail a package that returns a result with an accessor (%s)',
    async (kind) => {
      expect((await outcomes(kind)).filter((each) => each.pass)).toEqual([]);
    },
  );

  // A result padded with an unused large field must not switch the watch off (review of PR 986, probe 39702920607).
  it.each(['shared-padded', 'overwrite-padded'] as const)(
    'fail a package that pads its results with a field of 200,000 characters (%s)',
    async (kind) => {
      expect((await outcomes(kind)).filter((each) => each.pass)).toEqual([]);
    },
  );
});
