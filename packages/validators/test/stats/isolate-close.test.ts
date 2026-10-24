import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { statsBank } from '../../src/ladders/stats/bank/index';
import { runIsolated } from '../../src/ladders/stats/bank/isolate';
import { findRoot } from '../../src/root';

/**
 * The time the bank child spends after its last item (the frame makes every call again in run C when it closes) is
 * not the item's time: an item that is done must keep its verdict whatever the child does afterwards. Before, the
 * budget timer of the last item went on running while the child closed its frame, and an honest product that passed
 * was reported as "did not finish within N ms" (CI runs of PR 986: honest products rejected after 120 s).
 */

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

const ROOT = findRoot(process.cwd());
mkdirSync(join(ROOT, 'node_modules', '.cache'), { recursive: true });
const work = mkdtempSync(join(ROOT, 'node_modules', '.cache', 'isolate-close-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A copy of the statistics package that takes `seconds` to load in a process that is not confined (run C). */
function slowToLoadUnconfined(seconds: number, into: string): string {
  const src = join(into, 'src');
  cpSync(join(ROOT, 'packages', 'stats', 'src'), src, { recursive: true });
  const index = join(src, 'index.ts');
  writeFileSync(
    index,
    `if (!(process as { permission?: unknown }).permission) {\n  const end = Date.now() + ${seconds * 1000};\n  while (Date.now() < end) {\n    // wait\n  }\n}\n${readFileSync(index, 'utf8')}`,
  );
  return index;
}

describe('the end of the bank child', () => {
  it('keeps the verdict of the last item while the frame closes slowly', async () => {
    const items = statsBank(ROOT)
      .filter((item) => item.id.startsWith('reference.special.'))
      .slice(0, 2);
    const index = slowToLoadUnconfined(9, join(work, 'slow-close'));
    const before = process.env.DRIFTBENCH_STATS_IMPL;
    process.env.DRIFTBENCH_STATS_IMPL = index;
    try {
      // 4 s of budget per item; the close takes 9 s because run C loads the product slowly.
      const run = await runIsolated(items, 1, ROOT, () => 4_000, 1);
      expect(items.map((item) => [item.id, run.get(item.id)?.pass])).toEqual(
        items.map((item) => [item.id, true]),
      );
    } finally {
      if (before === undefined) delete process.env.DRIFTBENCH_STATS_IMPL;
      else process.env.DRIFTBENCH_STATS_IMPL = before;
    }
  });
});
