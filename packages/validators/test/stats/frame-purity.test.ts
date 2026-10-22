import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runItem, statsBank } from '../../src/ladders/stats/bank/index';
import { runIsolated } from '../../src/ladders/stats/bank/isolate';
import { findRoot } from '../../src/root';
import { type Purity, purityPackage } from './fixtures/frame-purity/build';

/**
 * The purity items (`roadmap-purity.*`) fail a method that changes its arguments. The frame sends arguments as data,
 * so the product changes its own copy and the item's arrays never change: the frame has to look for the write
 * itself (docs/validators.md section 12.9, "Written inputs").
 */

vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });

const ROOT = findRoot(process.cwd());
const ID = 'roadmap-purity.weightedMean';
const item = statsBank(ROOT).find((each) => each.id === ID);
mkdirSync(join(ROOT, 'node_modules', '.cache'), { recursive: true });
const work = mkdtempSync(join(ROOT, 'node_modules', '.cache', 'frame-purity-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** The verdicts of the item on seeds 1 to 3: in this process (the direct path) and through the bank child (the frame). */
async function verdicts(kind: Purity): Promise<{ direct: boolean[]; framed: boolean[] }> {
  if (!item) throw new Error(`no bank item ${ID}`);
  const index = purityPackage(ROOT, kind, join(work, kind));
  const impl = (await import(index)) as never;
  const direct: boolean[] = [];
  const framed: boolean[] = [];
  const before = process.env.DRIFTBENCH_STATS_IMPL;
  for (const seed of [1, 2, 3]) {
    const d = await runItem(item, seed, ROOT, impl);
    direct.push(d.pass);
    process.env.DRIFTBENCH_STATS_IMPL = index;
    try {
      const r = (await runIsolated([item], seed, ROOT)).get(ID);

      framed.push(r?.pass === true);
    } finally {
      if (before === undefined) delete process.env.DRIFTBENCH_STATS_IMPL;
      else process.env.DRIFTBENCH_STATS_IMPL = before;
    }
  }
  return { direct, framed };
}

describe(`the purity item ${ID} under the frame`, () => {
  it('passes a pure method both ways', async () => {
    expect(await verdicts('pure')).toEqual({ direct: [true, true, true], framed: [true, true, true] });
  });

  it('fails a method that changes its argument, as it does on the direct path', async () => {
    const got = await verdicts('sorts-in-place');
    expect(got.direct).toEqual([false, false, false]);
    expect(got.framed).toEqual([false, false, false]);
  });

  it('fails a method that writes to its argument and puts the value back', async () => {
    expect((await verdicts('writes-and-restores')).framed).toEqual([false, false, false]);
  });
});
