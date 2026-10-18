import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStore, type SqliteStore } from '../src/index';
import { campaign, run, tempDir } from './fixtures';

/**
 * Another process holds the whole file for longer than a store call used to wait: it takes the exclusive lock, says
 * "ready", keeps it, then commits. A live holder that is slow (a loaded machine, a large commit, a writer the
 * scheduler has not run for seconds) is a wait, never a failure: the call returns the stored version once the holder
 * is done. Fictional data only.
 */
const HOLDER = `import { DatabaseSync } from 'node:sqlite';
const [path, holdMs] = process.argv.slice(2);
const db = new DatabaseSync(path);
db.exec('PRAGMA busy_timeout = 5000');
db.exec('BEGIN EXCLUSIVE');
console.log('ready');
setTimeout(() => { db.exec('COMMIT'); db.close(); }, Number(holdMs));
`;

/** Longer than the 5 seconds a store call waited before, shorter than the wait it has now. */
const HOLD_MS = 6500;
const ID = 'c-stalled';

let dir: string;
let path: string;
let store: SqliteStore;

beforeEach(async () => {
  dir = await tempDir();
  path = join(dir, 'store.sqlite');
  store = openStore(path);
  await store.putCampaign(campaign(ID));
});

afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

/** Runs `act` once the holder says "ready", and ends when both the call and the holder have ended. */
async function whileStalled<T>(
  act: () => Promise<T>,
): Promise<{ value?: T; error?: unknown; waitedMs: number }> {
  const script = join(dir, 'holder.mjs');
  await writeFile(script, HOLDER);
  const child = spawn(process.execPath, [script, path, String(HOLD_MS)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ended = new Promise<number | null>((resolve) => child.on('exit', resolve));
  const outcome = new Promise<{ value?: T; error?: unknown; waitedMs: number }>((resolve) => {
    child.stdout.on('data', (chunk) => {
      if (!String(chunk).includes('ready')) return;
      const started = Date.now();
      act().then(
        (value) => resolve({ value, waitedMs: Date.now() - started }),
        (error: unknown) => resolve({ error, waitedMs: Date.now() - started }),
      );
    });
  });
  const result = await outcome;
  expect(await ended).toBe(0);
  return result;
}

describe('a store call and a live holder of the file that is slower than five seconds', () => {
  it('getRun waits for the holder and returns the stored run whole', async () => {
    const stored = run();
    await store.putRun(ID, stored);
    const { value, error, waitedMs } = await whileStalled(() => store.getRun(stored.runId, ID));
    expect(error).toBeUndefined();
    expect(value?.runId).toBe(stored.runId);
    expect(value?.blocks).toHaveLength(stored.blocks.length);
    expect(value?.cost).toBe(stored.cost);
    expect(waitedMs).toBeGreaterThan(HOLD_MS - 1500);
  }, 40_000);

  it('putRun waits for the holder and stores the run', async () => {
    const stored = run();
    const { error } = await whileStalled(() => store.putRun(ID, stored));
    expect(error).toBeUndefined();
    expect((await store.getRun(stored.runId, ID))?.runId).toBe(stored.runId);
  }, 40_000);
});
