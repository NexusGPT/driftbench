import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { generateSuite, generateSuiteToDisk } from '../../src/enumerate';
import { prepareMap } from '../../src/seed/map';

it('refuses to overwrite an existing spec even when the empty-directory precheck is bypassed', async () => {
  const prepared = prepareMap({
    version: 1,
    agent: 'garden-helper',
    produced_by: { family: 'unit', model: 'handwritten', at: '2026-01-01T00:00:00.000Z' },
    sources: [{ kind: 'prompt', path: 'garden.md' }],
    dimensions: [
      { id: 'care', kind: 'behaviour' as const, values: ['water', 'prune'] },
      { id: 'channel', kind: 'channel' as const, values: ['desk', 'widget'] },
      { id: 'persona', kind: 'persona' as const, values: ['gardener', 'volunteer'] },
    ].map(({ id, kind, values }) => ({
      id,
      title: id,
      kind,
      role: 'axis' as const,
      approved: true,
      produced_by: 'code' as const,
      values: values.map((value) => ({
        id: value,
        title: value,
        produced_by: 'code' as const,
        evidence: { source: 'garden.md', quote: 'Water the fern.' },
      })),
    })),
    constraints: [],
    phrases: [
      {
        dimension: 'care',
        value: 'water',
        text: 'Water the fern.',
        lang: 'en',
        approved: true,
        produced_by: 'code',
      },
    ],
  });
  const options = { mapPath: 'garden.yaml', t: 2 };
  const file = generateSuite(prepared, options).files.find((entry) => entry.path.endsWith('.yaml'));
  if (!file) throw new Error('No garden spec generated');
  const directory = await mkdtemp(join(tmpdir(), 'garden-wx-'));
  const target = join(directory, file.path);
  const original = Buffer.from('Existing garden note: café 🌿\n');
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, original);
    // Simulate a stale empty-directory observation. Every write still uses the real writable filesystem.
    const precheck = vi.spyOn(fs, 'readdirSync').mockImplementationOnce((path) => {
      expect(String(path)).toBe(directory);
      return [];
    });
    syncBuiltinESMExports();
    expect(() => generateSuiteToDisk(prepared, { ...options, outputDir: directory })).toThrowError(
      expect.objectContaining({ code: 'EEXIST', path: target }),
    );
    expect(precheck).toHaveBeenCalledWith(directory);
    expect(await readFile(target)).toEqual(original);
  } finally {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    await rm(directory, { recursive: true, force: true });
  }
});
