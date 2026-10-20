import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { statsBank } from '../../src/ladders/stats/bank/index';
import { runIsolated } from '../../src/ladders/stats/bank/isolate';
import { findRoot } from '../../src/root';
import { cheatingPackage } from './fixtures/frame-cheats/build';

/**
 * The statistics bank under the frame (docs/validators.md section 12.9). The cheater audit of the weights family
 * wrote statistics packages that run their honest code only when they tell a validator runs them, and a plausible
 * wrong code for anyone else: by the call stack, by the process arguments, and by reading the file that holds the
 * expected values (a read handed bound to `Array.map` passed the trap). Under the old child process they gained
 * every weights item the honest code passes. Under the frame the package runs confined, called in more than one
 * way, so none of them passes an item that the always-wrong package fails.
 */

vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });

const ROOT = findRoot(process.cwd());
const SEED = 977;
const items = statsBank(ROOT).filter((item) => item.family.startsWith('weights-'));
const work = mkdtempSync(join(ROOT, 'node_modules', '.cache', 'frame-cheats-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** The ids a package passes, when the bank child tests the package at `index`. */
async function passing(gate: string): Promise<Set<string>> {
  const index = cheatingPackage(ROOT, gate, join(work, gate));
  const before = process.env.DRIFTBENCH_STATS_IMPL;
  process.env.DRIFTBENCH_STATS_IMPL = index;
  try {
    const run = await runIsolated(items, SEED, ROOT);
    return new Set(items.filter((item) => run.get(item.id)?.pass).map((item) => item.id));
  } finally {
    if (before === undefined) delete process.env.DRIFTBENCH_STATS_IMPL;
    else process.env.DRIFTBENCH_STATS_IMPL = before;
  }
}

describe('the cheating statistics packages of the weights audit', () => {
  it('the honest package passes the weights items: the frame costs it nothing', async () => {
    expect((await passing('honest')).size).toBe(items.length);
  });

  it.each(['oracle-plain', 'oracle-bound', 'sniff-stack-plain', 'sniff-stack-dodge', 'sniff-argv-dodge'])(
    '%s passes no item that the package always running its wrong code fails',
    async (gate) => {
      const user = await passing('user');
      const cheat = await passing(gate);
      expect([...cheat].filter((id) => !user.has(id))).toEqual([]);
    },
  );
});
