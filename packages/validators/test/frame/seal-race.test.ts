import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';

const ISOLATE = new URL('../../src/frame/isolate.ts', import.meta.url).href;
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

it('closing a frame cannot delete the same-seed same-tag bundle another process is about to read', async () => {
  const cache = join(ROOT, 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  const area = mkdtempSync(join(cache, 'frame-seal-race-'));
  const product = join(area, 'product');
  mkdirSync(product);
  const module = join(product, 'good.mjs');
  writeFileSync(module, 'export const value = () => 137;\n');
  const start = (role: string) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { isolate } from ${JSON.stringify(ISOLATE)};
const area = ${JSON.stringify(area)};
const role = ${JSON.stringify(role)};
const wait = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
const until = Date.now() + 20000;
if (role === 'b') {
  const read = fs.readFileSync;
  const cache = fs.realpathSync(${JSON.stringify(cache)});
  fs.readFileSync = function(file, ...args) {
    if (typeof file === 'string' && file.endsWith('.mjs') && dirname(dirname(file)) === cache) {
      // Pause at sealOnce's read of the completed bundle, before opening its file descriptor.
      fs.writeFileSync(join(area, 'b.ready'), file);
      while (!fs.existsSync(join(area, 'b.release')) && Date.now() < until) wait();
    }
    return read.call(this, file, ...args);
  };
  syncBuiltinESMExports();
}
const frame = isolate({ module: ${JSON.stringify(module)}, seed: 1, tag: 'planner:odd-sizes' });
try {
  if (role === 'a') {
    fs.writeFileSync(join(area, 'a.ready'), 'ready');
    while (!fs.existsSync(join(area, 'a.release')) && Date.now() < until) wait();
  }
  console.log(frame.product.value());
  if (frame.divergence()) throw new Error(frame.divergence());
} finally { frame.close(); }
`,
      ],
      { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    return new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, out, err }));
    });
  };
  const a = start('a');
  let b: ReturnType<typeof start> | undefined;
  try {
    await vi.waitFor(() => expect(existsSync(join(area, 'a.ready'))).toBe(true), { timeout: 15_000 });
    b = start('b');
    await vi.waitFor(() => expect(existsSync(join(area, 'b.ready'))).toBe(true), { timeout: 15_000 });
    const bundle = readFileSync(join(area, 'b.ready'), 'utf8');
    expect(existsSync(bundle)).toBe(true);
    writeFileSync(join(area, 'a.release'), 'close');
    const first = await a;
    expect(first.code, first.err).toBe(0);
    // In the old code A's close unlinks B's bundle here, making the pending read throw ENOENT.
    writeFileSync(join(area, 'b.release'), 'read');
    const second = await b;
    expect(second.code, second.err).toBe(0);
    expect(second.out.trim()).toBe('137');
  } finally {
    for (const role of ['a', 'b']) writeFileSync(join(area, role + '.release'), 'go');
    await Promise.allSettled([a, b]);
    rmSync(area, { recursive: true, force: true });
  }
}, 60_000);
