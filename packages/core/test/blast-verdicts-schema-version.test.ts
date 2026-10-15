import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { loadSpecFile, loadSpecs } from '../src/index';

/**
 * Blast-radius audit of schema_version (PR 431): a spec without it keeps the hash it had before (every sealed
 * holdout records the hash its specs had when sealed), and every file loader refuses a newer format first.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SEALS = [
  'examples/acme/gated/holdout/seal.json',
  'examples/acme/gated/control-handwritten/holdout/seal.json',
];
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

describe('blast radius: schema_version and the spec loaders', () => {
  it('every sealed spec, written before schema_version, loads to the hash its seal recorded', async () => {
    let checked = 0;
    for (const seal of SEALS) {
      const doc = JSON.parse(await readFile(join(ROOT, seal), 'utf8')) as {
        specs: Array<{ id: string; path: string; hash: string }>;
      };
      for (const entry of doc.specs) {
        const loaded = await loadSpecFile(join(ROOT, dirname(seal), '..', entry.path));
        expect(loaded.ok, entry.path).toBe(true);
        if (!loaded.ok) continue;
        expect('schema_version' in loaded.spec, entry.path).toBe(false);
        expect(loaded.hash, entry.path).toBe(entry.hash);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('a YAML and a JSON file of a newer format are each refused with the one upgrade error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-blast-schema-'));
    made.push(dir);
    await writeFile(
      join(dir, 'newer.yaml'),
      'schema_version: 2\nid: newer\nfuture_key: 1\nblocks:\n  - user: Hi\n',
    );
    await writeFile(
      join(dir, 'newer.spec.json'),
      JSON.stringify({ schema_version: 3, id: 'newer-json', blocks: [{ user: 'Hi' }] }),
    );
    await writeFile(join(dir, 'current.yaml'), 'schema_version: 1\nid: current\nblocks:\n  - user: Hi\n');
    const results = await loadSpecs([dir]);
    const byFile = new Map(results.map((result) => [result.path.split('/').pop(), result]));
    for (const name of ['newer.yaml', 'newer.spec.json']) {
      const result = byFile.get(name);
      expect(result?.ok, name).toBe(false);
      if (result && !result.ok) {
        expect(result.errors.map((issue) => issue.code)).toEqual(['SPEC_SCHEMA_VERSION']);
        expect(result.errors[0]?.message).toContain('upgrade driftbench');
      }
    }
    expect(byFile.get('current.yaml')?.ok).toBe(true);
  });
});
