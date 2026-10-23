import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';

const ISOLATE = new URL('../../src/frame/isolate.ts', import.meta.url).href;
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

it('closing one simultaneous run C leaves its sibling with the same seed, tag and count alive', async () => {
  const cache = join(ROOT, 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  const area = mkdtempSync(join(cache, 'frame-group-race-'));
  const product = join(area, 'product');
  const signals = join(area, 'signals');
  mkdirSync(product);
  mkdirSync(signals);
  const module = join(product, 'hold.mjs');
  writeFileSync(
    module,
    `
import fs from 'node:fs';
import { join } from 'node:path';
const signals = ${JSON.stringify(signals)};
export async function hold(role) {
  // Only unconfined run C can write the barrier; the other runs answer immediately.
  try { fs.writeFileSync(join(signals, role + '.ready'), 'ready'); } catch { return role; }
  const until = Date.now() + 20000;
  while (!fs.existsSync(join(signals, role + '.release')) && Date.now() < until) {
    if (role === 'b' && fs.existsSync(join(signals, 'poke'))) fs.writeFileSync(join(signals, 'alive'), 'yes');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return role;
}
`,
  );
  const start = (role: string) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
import { isolate } from ${JSON.stringify(ISOLATE)};
const frame = isolate({ module: ${JSON.stringify(module)}, seed: 7, tag: 'same-process-item' });
try {
  const ret = frame.product.hold(${JSON.stringify(role)});
  const divergence = frame.divergence();
  if (divergence) throw new Error(divergence);
  console.log(JSON.stringify({ ret, plain: frame.tape.at(-1).plain }));
} finally { frame.close(); }
`,
      ],
      {
        cwd: ROOT,
        // Exercise the actual tag sweep even on hosts whose PID namespaces isolate descendants.
        env: { ...process.env, DRIFTBENCH_FRAME_NO_NAMESPACE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    const done = new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, out, err }));
    });
    return { done };
  };
  const a = start('a');
  const b = start('b');
  try {
    await vi.waitFor(
      () => {
        expect(existsSync(join(signals, 'a.ready'))).toBe(true);
        expect(existsSync(join(signals, 'b.ready'))).toBe(true);
      },
      { interval: 20, timeout: 15_000 },
    );
    // Both calls are now in run C at count 1. End and close A, then require B to do new work.
    writeFileSync(join(signals, 'a.release'), 'go');
    const first = await a.done;
    expect(first.code, first.err).toBe(0);
    writeFileSync(join(signals, 'poke'), 'are you alive?');
    await vi.waitFor(() => expect(existsSync(join(signals, 'alive'))).toBe(true), { timeout: 2_000 });
    expect(readFileSync(join(signals, 'alive'), 'utf8')).toBe('yes');
    writeFileSync(join(signals, 'b.release'), 'go');
    const second = await b.done;
    expect(second.code, second.err).toBe(0);
    expect(JSON.parse(second.out)).toEqual({ ret: 'b', plain: { ret: 'b' } });
  } finally {
    for (const role of ['a', 'b']) writeFileSync(join(signals, role + '.release'), 'go');
    await Promise.allSettled([a.done, b.done]);
    rmSync(area, { recursive: true, force: true });
  }
}, 60_000);
