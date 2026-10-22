import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runItem, statsBank } from '../../src/ladders/stats/bank/index';
import { runIsolated } from '../../src/ladders/stats/bank/isolate';
import { findRoot } from '../../src/root';
import { writingMeanPackage } from './fixtures/frame-purity/build';

/**
 * A product that changes a built-in object of its process changes how its caller's own code runs after the call. The
 * mean-shift items call `mean(v)`, then map `v` themselves: a mean that replaces the array prototype's `map` after it
 * computed the right answer fails them directly, and passed them through the frame, whose confined runs keep the
 * change in their own process (review of PR 986, codex run 39782335737). The frame now records the built-in objects
 * before the product loads and the item fails on the first one changed (docs/validators.md section 12.9, "Built-in
 * objects").
 */

vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });

const ROOT = findRoot(process.cwd());
const shifts = statsBank(ROOT).filter((each) => each.id.startsWith('stability.mean-shift-'));
mkdirSync(join(ROOT, 'node_modules', '.cache'), { recursive: true });
const work = mkdtempSync(join(ROOT, 'node_modules', '.cache', 'frame-builtins-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

type Verdict = { seed: number; id: string; pass: boolean; detail: string };

/**
 * The verdicts of the two mean-shift items on seeds 1 to 3, directly and through the frame. The direct path runs the
 * product in this process, so the built-in it replaces is put back after each item: the change must not reach the
 * rest of the test.
 */
async function verdicts(name: string, code: string): Promise<{ direct: Verdict[]; framed: Verdict[] }> {
  const index = writingMeanPackage(ROOT, join(work, name), code);
  const impl = (await import(index)) as never;
  const realMap = Array.prototype.map;
  const before = process.env.DRIFTBENCH_STATS_IMPL;
  const direct: Verdict[] = [];
  const framed: Verdict[] = [];
  for (const seed of [1, 2, 3]) {
    for (const each of shifts) {
      let outcome: { pass: boolean; detail: string };
      try {
        outcome = await runItem(each, seed, ROOT, impl);
      } finally {
        Array.prototype.map = realMap;
      }
      direct.push({ seed, id: each.id, pass: outcome.pass, detail: outcome.detail });
    }
    process.env.DRIFTBENCH_STATS_IMPL = index;
    try {
      const run = await runIsolated(shifts, seed, ROOT);
      for (const each of shifts)
        framed.push({
          seed,
          id: each.id,
          pass: run.get(each.id)?.pass === true,
          detail: run.get(each.id)?.detail ?? 'no outcome',
        });
    } finally {
      if (before === undefined) delete process.env.DRIFTBENCH_STATS_IMPL;
      else process.env.DRIFTBENCH_STATS_IMPL = before;
    }
  }
  return { direct, framed };
}

describe('the mean-shift items with a mean that changes a built-in object after it computed the right answer', () => {
  it('are the two items the test is about', () => {
    expect(shifts.map((each) => each.id)).toEqual([
      'stability.mean-shift-1000000',
      'stability.mean-shift-1000000000',
    ]);
  });

  // The reviewer's product: the array prototype's map becomes filter for an array of the item's length (1000), which
  // keeps every value the item's shift returns, so the item's shifted array is the unshifted one; every other array
  // maps as before, so the three runs still answer alike. And the same replacement put back by its first use, so
  // nothing is left changed after the item's own map: the change is seen at the end of the call that made it.
  it.each([
    [
      'replaced',
      'const proto = Object.getPrototypeOf(target); const real = proto.map; proto.map = function (this: unknown[], f: unknown) { return (this.length === 1000 ? Array.prototype.filter : real).call(this, f as never); };',
    ],
    [
      'replaced until its first use',
      'const proto = Object.getPrototypeOf(target); const real = proto.map; proto.map = function (this: unknown, f: unknown) { proto.map = real; return Array.prototype.filter.call(this, f as never); };',
    ],
  ])('fail through the frame as they do directly (map %s)', async (_name, code) => {
    const got = await verdicts(_name === 'replaced' ? 'map-replaced' : 'map-once', code);
    expect(got.direct.map((v) => v.pass)).toEqual([false, false, false, false, false, false]);
    expect(got.framed.map((v) => v.pass)).toEqual([false, false, false, false, false, false]);
    for (const each of got.framed)
      expect(each.detail, `${each.id} seed ${each.seed}`).toContain(
        'the package changed a built-in object: mean() ran in a process where the product had changed a built-in object, Array.prototype.map (',
      );
  });

  // The control: the same wrapper with no change passes both ways, so the failures above are the built-in's.
  it('pass the same wrapper when it changes nothing, both ways', async () => {
    const got = await verdicts('nothing', '');
    expect(got.direct.map((v) => v.pass)).toEqual([true, true, true, true, true, true]);
    expect(got.framed.map((v) => v.pass)).toEqual([true, true, true, true, true, true]);
  });
});
