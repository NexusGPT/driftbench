import * as childProcess from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runIsolated } from '../../../src/ladders/judges/v2/isolate';
import { faultFixtureItems } from './fixtures/isolated-faults';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const fixture = fileURLToPath(new URL('./fixtures/isolated-faults.ts', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const ids = faultFixtureItems.map((item) => item.id);

/** The real runner and real child processes; only the bank the child runs is the fault fixture, in one mode. */
async function runFaults(mode: string, budgetMs = 30_000) {
  const { spawn } = await vi.importActual<typeof childProcess>('node:child_process');
  const child = vi
    .mocked(childProcess.spawn)
    .mockClear()
    .mockImplementation((command, args, options) =>
      spawn(command, [...(args ?? []).slice(0, 2), fixture, ...(args ?? []).slice(3)], {
        ...options,
        env: { ...process.env, FIXTURE_MODE: mode },
      }),
    );
  const run = await runIsolated(faultFixtureItems, 1, ROOT, budgetMs, 1);
  return { run, starts: child.mock.calls.map((call) => call[1]?.at(-1)) };
}

describe('the judges isolation runner accounts for every item', { timeout: 120_000 }, () => {
  afterEach(() => vi.mocked(childProcess.spawn).mockClear());

  it('runs the items a child left unreported when it ended with exit code 0', async () => {
    const { run, starts } = await runFaults('quits-once');
    expect([...run.keys()].sort()).toEqual(ids);
    expect(ids.map((id) => run.get(id)?.pass)).toEqual([true, true, true, true, true]);
    // The first child reported two items and ended; a second one resumed at the third.
    expect(starts).toEqual(['0', '2']);
  });

  it.each([
    ['a promise nothing settles', 'pending-promise'],
    ['a call that ends the process', 'item-exits'],
  ])(
    'fails by name an item that ends the child with exit code 0 (%s), and runs the items after it',
    async (_name, mode) => {
      const { run, starts } = await runFaults(mode);
      expect([...run.keys()].sort()).toEqual(ids);
      expect(ids.map((id) => run.get(id)?.pass)).toEqual([true, true, false, true, true]);
      expect(run.get('fault.c')?.detail).toMatch(/ended \(exit 0\) on seed 1 without reporting this item/);
      // One child up to the item, one that ends on it at once, one for the rest.
      expect(starts).toEqual(['0', '2', '3']);
    },
  );

  it('still fails an item slower than its budget, and runs the items after it', async () => {
    const { run } = await runFaults('slow', 2_000);
    expect(ids.map((id) => run.get(id)?.pass)).toEqual([true, true, false, true, true]);
    expect(run.get('fault.c')?.detail).toMatch(
      /^timed out: the item did not finish within 2000 ms on seed 1/,
    );
  });

  it('reads every outcome when the output is far larger than a pipe holds', async () => {
    const { run, starts } = await runFaults('floods');
    expect(ids.map((id) => run.get(id)?.pass)).toEqual([true, true, true, true, true]);
    expect(run.get('fault.d')?.detail).toHaveLength(400_000);
    expect(starts).toEqual(['0']);
  });
});
