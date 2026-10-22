import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runItem, statsBank } from '../../src/ladders/stats/bank/index';
import { runIsolated } from '../../src/ladders/stats/bank/isolate';
import { findRoot } from '../../src/root';
import { fillingMeanPackage, type Purity, purityPackage } from './fixtures/frame-purity/build';

/**
 * The purity items (`roadmap-purity.*`) fail a method that changes its arguments. The frame sends arguments as data,
 * so the product changes its own copy and the item's arrays never change: the frame has to look for the write
 * itself (docs/validators.md section 12.9, "Written inputs").
 */

vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });

const ROOT = findRoot(process.cwd());
const ID = 'roadmap-purity.weightedMean';
const item = statsBank(ROOT).find((each) => each.id === ID);
// The same method, checked for its value only: no purity check, so the frame adds no rule.
const PLAIN = 'roadmap.weightedMean.1';
const plain = statsBank(ROOT).find((each) => each.id === PLAIN);
mkdirSync(join(ROOT, 'node_modules', '.cache'), { recursive: true });
const work = mkdtempSync(join(ROOT, 'node_modules', '.cache', 'frame-purity-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** The verdicts of the item on seeds 1 to 3: in this process (the direct path) and through the bank child (the frame). */
async function verdicts(kind: Purity, target = item): Promise<{ direct: boolean[]; framed: boolean[] }> {
  if (!target) throw new Error('no bank item');
  const index = purityPackage(ROOT, kind, join(work, kind));
  const impl = (await import(index)) as never;
  const direct: boolean[] = [];
  const framed: boolean[] = [];
  const before = process.env.DRIFTBENCH_STATS_IMPL;
  for (const seed of [1, 2, 3]) {
    const d = await runItem(target, seed, ROOT, impl);
    direct.push(d.pass);
    process.env.DRIFTBENCH_STATS_IMPL = index;
    try {
      const r = (await runIsolated([target], seed, ROOT)).get(target.id);

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

  it('passes the same sorting method on an item with no purity check, as it does directly', async () => {
    expect(plain?.purity).toBeUndefined();
    expect(item?.purity).toBe(true);
    expect(await verdicts('sorts-in-place', plain)).toEqual({
      direct: [true, true, true],
      framed: [true, true, true],
    });
  });
});

// A product computes the right mean, then fills the caller's 1000-value array with 10000. The mean-shift items read
// that array again, so they reject it directly; the frame has to give the caller the product's write (review of
// PR 986, codex run 39733374457).
describe('the mean-shift items under the frame with a product that fills its input afterwards', () => {
  const shifts = statsBank(ROOT).filter((each) => each.id.startsWith('stability.mean-shift-'));
  it('fail through the frame as they do directly', async () => {
    expect(shifts.map((each) => each.id)).toEqual([
      'stability.mean-shift-1000000',
      'stability.mean-shift-1000000000',
    ]);
    const index = fillingMeanPackage(ROOT, join(work, 'fills-mean'));
    const impl = (await import(index)) as never;
    const before = process.env.DRIFTBENCH_STATS_IMPL;
    const direct: boolean[] = [];
    const framed: boolean[] = [];
    for (const seed of [1, 2, 3]) {
      for (const each of shifts) direct.push((await runItem(each, seed, ROOT, impl)).pass);
      process.env.DRIFTBENCH_STATS_IMPL = index;
      try {
        const run = await runIsolated(shifts, seed, ROOT);
        for (const each of shifts) framed.push(run.get(each.id)?.pass === true);
      } finally {
        if (before === undefined) delete process.env.DRIFTBENCH_STATS_IMPL;
        else process.env.DRIFTBENCH_STATS_IMPL = before;
      }
    }
    expect(direct).toEqual([false, false, false, false, false, false]);
    expect(framed).toEqual(direct);
  });
});
