import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { statsBank } from '../../src/ladders/stats/bank/index';
import { runIsolated } from '../../src/ladders/stats/bank/isolate';
import { findRoot } from '../../src/root';
import { writingMeanPackage } from './fixtures/frame-purity/build';

/**
 * The frame compares every call with run C, the unconfined user-shaped run, only when it closes. A bank child whose
 * frame throws while closing ends without its last line ({closed: true}), and none of its outcomes counts (review of
 * PR 986, codex run 39831471814: a mean that is right in the confined runs but breaks JSON.stringify in run C made
 * the frame throw at close, and both mean-shift items it had already reported as passing were kept).
 */

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

const ROOT = findRoot(process.cwd());
const shifts = statsBank(ROOT).filter((each) => each.id.startsWith('stability.mean-shift-'));
mkdirSync(join(ROOT, 'node_modules', '.cache'), { recursive: true });
const work = mkdtempSync(join(ROOT, 'node_modules', '.cache', 'frame-close-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** The outcomes of the two mean-shift items on seed 1 through the frame, for a mean that runs `code` after it. */
async function outcomes(name: string, code: string) {
  const index = writingMeanPackage(ROOT, join(work, name), code);
  const before = process.env.DRIFTBENCH_STATS_IMPL;
  process.env.DRIFTBENCH_STATS_IMPL = index;
  try {
    const run = await runIsolated(shifts, 1, ROOT);
    return shifts.map((each) => ({
      id: each.id,
      pass: run.get(each.id)?.pass === true,
      detail: run.get(each.id)?.detail ?? '',
    }));
  } finally {
    if (before === undefined) delete process.env.DRIFTBENCH_STATS_IMPL;
    else process.env.DRIFTBENCH_STATS_IMPL = before;
  }
}

describe('a bank child whose frame does not close', () => {
  it('counts none of its outcomes: a mean that breaks the output of run C fails both mean-shift items', async () => {
    // Confined runs have the permission model on; run C, the user's own process, does not.
    const got = await outcomes(
      'breaks-run-c',
      "if (!(process as { permission?: unknown }).permission) {\n    JSON.stringify = () => '{';\n    return 0;\n  }",
    );
    expect(got.map((each) => each.pass)).toEqual([false, false]);
    for (const each of got) expect(each.detail, each.id).toMatch(/ended without closing its frame \(exit 1/);
  });

  it('counts the outcomes of the same wrapper when it changes nothing', async () => {
    const got = await outcomes('nothing', '');
    expect(got.map((each) => each.pass)).toEqual([true, true]);
  });
});
