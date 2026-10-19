import { mkdtempSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import setup from './temp-guard';

const teardowns: Array<() => Promise<void>> = [];
afterEach(async () => {
  // Undo any setup a test left open, newest first, so the outer run's folder comes back.
  while (teardowns.length > 0)
    await teardowns
      .pop()?.()
      .catch(() => undefined);
});

async function open(): Promise<() => Promise<void>> {
  const teardown = await setup();
  teardowns.push(teardown);
  return teardown;
}

describe('the temp-folder guard', () => {
  it('sends tmpdir() into a private folder for the run', async () => {
    const outer = tmpdir();
    await open();
    expect(tmpdir()).not.toBe(outer);
    expect(tmpdir().startsWith(outer)).toBe(true);
  });

  it('passes when the run removed what it made', async () => {
    const teardown = await open();
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-guard-clean-'));
    await rm(dir, { recursive: true, force: true });
    teardowns.pop();
    await expect(teardown()).resolves.toBeUndefined();
  });

  it('fails when a folder is left behind, and removes it', async () => {
    const outer = tmpdir();
    const teardown = await open();
    const inner = tmpdir();
    const dir = mkdtempSync(join(inner, 'driftbench-guard-leak-'));
    writeFileSync(join(dir, 'file.txt'), 'x');
    teardowns.pop();
    await expect(teardown()).rejects.toThrow(/left 1 entries.*driftbench-guard-leak-/);
    expect(tmpdir()).toBe(outer);
    await expect(rm(inner, { recursive: false })).rejects.toThrow();
  });
});
