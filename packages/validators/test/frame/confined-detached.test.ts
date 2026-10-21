import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Frame, isolate } from '../../src/frame';
import { namespaceAvailable } from '../../src/frame/group';
import { findRoot } from '../../src/root';

/**
 * Nothing run C starts outlives it (review of PR 969: a detached process of run C wrote into the tree after the
 * invocation ended, after the last look). The product below reads the file of expected values, which only run C can,
 * and then starts a detached sleeper that writes a file four seconds later, in a session of its own, with no
 * reference kept. After the frame the sleeper must be dead and the file never written.
 */
vi.setConfig({ testTimeout: 300_000 });

const repo = findRoot(dirname(fileURLToPath(import.meta.url)));
let work = '';

beforeAll(() => {
  const cache = join(repo, 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  work = realpathSync(mkdtempSync(join(cache, 'frame-detached-')));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('what run C starts', () => {
  it('a detached sleeper writer of run C is dead after the frame and has written nothing', async () => {
    const oracle = join(work, 'expected.json');
    writeFileSync(oracle, '137');
    const late = join(work, 'late.txt');
    const module = join(work, 'sleeper.mjs');
    writeFileSync(
      module,
      `import { spawn } from 'node:child_process';
import fs from 'node:fs';
try {
  fs.readFileSync(${JSON.stringify(oracle)}, 'utf8');
  spawn(
    process.execPath,
    ['-e', ${JSON.stringify(`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(late)}, 'late'), 4000)`)}],
    { detached: true, stdio: 'ignore' },
  ).unref();
} catch {}
export const get = () => 137;
`,
    );
    let frame: Frame<{ get: () => number }> | undefined;
    try {
      frame = isolate<{ get: () => number }>({ module, seed: 1 });
      frame.product.get();
      frame.divergence();
    } finally {
      frame?.close();
    }
    await sleep(7000);
    expect(existsSync(late)).toBe(false);
  });

  it('D1: a detached writer that clears its environment and leaves the session is dead after the frame (Linux, PID namespace)', async () => {
    // On Linux the validators run in CI with a PID namespace: the kernel kills every process of it with run C. Where
    // the system has none (macOS), the session and tag kill is the residual (docs/validators.md section 12.9).
    // DRIFTBENCH_FRAME_NO_NAMESPACE=1 is the mutant of the mutation run: the writer must then survive and fail the test.
    if (process.platform !== 'linux') return;
    if (process.env.DRIFTBENCH_FRAME_NO_NAMESPACE !== '1') expect(namespaceAvailable()).toBe(true);
    const oracle = join(work, 'expected-d1.json');
    writeFileSync(oracle, '137');
    const late = join(work, 'late-d1.txt');
    const module = join(work, 'sleeper-d1.mjs');
    writeFileSync(
      module,
      `import { spawn } from 'node:child_process';
import fs from 'node:fs';
try {
  fs.readFileSync(${JSON.stringify(oracle)}, 'utf8');
  spawn(
    process.execPath,
    ['-e', ${JSON.stringify(`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(late)}, 'late'), 4000)`)}],
    { detached: true, stdio: 'ignore', env: {} },
  ).unref();
} catch {}
export const get = () => 137;
`,
    );
    let frame: Frame<{ get: () => number }> | undefined;
    try {
      frame = isolate<{ get: () => number }>({ module, seed: 2 });
      frame.product.get();
      frame.divergence();
    } finally {
      frame?.close();
    }
    await sleep(7000);
    expect(existsSync(late)).toBe(false);
  });
});
