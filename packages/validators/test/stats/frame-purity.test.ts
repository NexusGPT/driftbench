import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runItem, statsBank } from '../../src/ladders/stats/bank/index';
import { runIsolated } from '../../src/ladders/stats/bank/isolate';
import { findRoot } from '../../src/root';
import {
  fillingBootstrapPackage,
  fillingMeanPackage,
  MEAN_WRITES,
  type Purity,
  purityPackage,
  writingMeanPackage,
} from './fixtures/frame-purity/build';

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

// A bootstrapCI that fills its input after it returned: the shifted bootstrap items build their input fresh for each
// call (`v` is read again only by the second call's `v.map`), and the first call's input is the array the second
// call maps. They agree directly and through the frame (the verdicts are compared, not asserted to be a pass).
describe('the shifted bootstrap items with a bootstrapCI that fills its input afterwards', () => {
  const shifts = statsBank(ROOT).filter((each) => each.id.startsWith('stability.bootstrap-shift-'));
  it.each([
    ['any length', undefined],
    ['length 1000 only', 1000],
  ])('give the same verdict directly and through the frame (fills %s)', async (_name, onlyLength) => {
    const index = fillingBootstrapPackage(
      ROOT,
      join(work, `fills-bootstrap-${onlyLength ?? 'any'}`),
      onlyLength,
    );
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
    if (onlyLength === undefined) expect(direct).toEqual([false, false, false, false, false, false]);
    else expect(direct).toEqual([true, true, true, true, true, true]);
    expect(framed).toEqual(direct);
  });
});

// Codex's own-map product (run 39741702796): the mean is right, then the product defines its own `map` on the
// caller's array. The mean-shift items reject it directly; a copy of the array's elements cannot carry it, so the
// frame reports a change it cannot reproduce.
describe('the mean-shift items with a product that writes to its input afterwards, of every kind', () => {
  const shifts = statsBank(ROOT).filter((each) => each.id.startsWith('stability.mean-shift-'));
  const verdicts2 = async (name: string, code: string) => {
    const index = writingMeanPackage(ROOT, join(work, `writes-${name}`), code);
    const impl = (await import(index)) as never;
    const before = process.env.DRIFTBENCH_STATS_IMPL;
    const direct: boolean[] = [];
    const framed: boolean[] = [];
    for (const seed of [1, 2]) {
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
    return { direct, framed };
  };

  it("fails codex's own-map product through the frame, as it does directly", async () => {
    const got = await verdicts2('codex-map', 'target.map = Array.prototype.filter;');
    expect(got.direct).toEqual([false, false, false, false]);
    expect(got.framed).toEqual(got.direct);
  });

  // Generated: every kind of write, alone and in pairs drawn from a fixed generator. A write the frame can copy back
  // gives the same verdict as directly; any other write never passes where the direct run fails (and the frame fails
  // it as a change it cannot reproduce).
  it('never passes a product that fails directly, and agrees on every write the frame can copy back', async () => {
    let state = 986;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const programs = [
      ...MEAN_WRITES.map((write) => [write]),
      ...Array.from({ length: 8 }, () => [
        MEAN_WRITES[Math.floor(next() * MEAN_WRITES.length)],
        MEAN_WRITES[Math.floor(next() * MEAN_WRITES.length)],
      ]),
    ] as Array<typeof MEAN_WRITES>;
    for (const program of programs) {
      const name = program.map((write) => write.name).join('+');
      const got = await verdicts2(name.replace(/\W/g, '_'), program.map((write) => write.code).join(' '));
      const copy = program.every((write) => write.copy);
      got.direct.forEach((pass, index) => {
        if (!pass) expect(got.framed[index], `${name} item ${index}`).toBe(false);
        else if (copy) expect(got.framed[index], `${name} item ${index}`).toBe(true);
      });
    }
  });
});
