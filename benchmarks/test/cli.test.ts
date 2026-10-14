import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@agent-nexus/driftbench-store';
import { describe, expect, it } from 'vitest';
import { main } from '../cli';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
async function run(args: string[]) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd,
    out: (s) => {
      out += s;
    },
    err: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}
describe('bench CLI', () => {
  it('lists replay and record commands', async () => {
    const r = await run(['--help']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('replay');
    expect(r.out).toContain('record');
    expect(r.out).toContain('floors');
  });
  it('refuses an unknown slice before recording', async () => {
    const r = await run(['record', '--slice', 'absent', '--model', 'haiku', '--spend-cap-usd', '0.1']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('Unknown slice');
  });
  it('requires explicit spend authorization for Gemini too', async () => {
    const r = await run(['record', '--model', 'gemini-3.5-flash-lite']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('--spend-cap-usd');
  });
  it('registers the exact dataset version of a replayed slice in --store, and nothing without it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-bench-store-'));
    try {
      const manifest = JSON.parse(await readFile(join(cwd, 'benchmarks/manifest.json'), 'utf8')) as {
        slices: Array<{ name: string; version: number; hash: string }>;
      };
      const slice = manifest.slices.find((entry) => entry.name === 'heldout-rubric');
      if (!slice) throw new Error('no heldout-rubric slice');
      const file = join(dir, 'bench.db');
      const args = ['replay', '--slice', slice.name, '--model', 'haiku'];
      const plain = await run(args);
      const stored = await run([...args, '--store', file]);
      expect([stored.code, stored.err]).toEqual([plain.code, plain.err]);
      expect(stored.out).toBe(plain.out);
      const store = openStore(file);
      try {
        const versions = await store.listVersions('dataset', slice.name);
        expect(versions.map((entry) => [entry.version, entry.hash])).toEqual([[slice.version, slice.hash]]);
        // Replaying again registers nothing new: the same content is the same version.
        await run([...args, '--store', file]);
        expect(await store.listVersions('dataset', slice.name)).toHaveLength(1);
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
  it.each(['0', '17', '2.5', 'many'])('refuses --concurrency %s before any recording call', async (value) => {
    const r = await run([
      'record',
      '--slice',
      'heldout-rubric',
      '--model',
      'haiku',
      '--spend-cap-usd',
      '0.01',
      '--concurrency',
      value,
    ]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('--concurrency must be 1..16');
    expect(r.out).toBe('');
  });
  it('requires explicit spend authorization before a record', async () => {
    const r = await run(['record', '--slice', 'all', '--model', 'haiku']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('--spend-cap-usd');
  });
});
