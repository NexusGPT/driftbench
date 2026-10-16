import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.mock('compromise/two', async (importOriginal) => {
  const real = await importOriginal<typeof import('compromise/two')>();
  return {
    ...real,
    default: (text: string) => {
      if (text === 'The helper must trigger a parser failure.')
        throw new Error('injected sentence parser failure');
      return real.default(text);
    },
  };
});

import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { estateScanCommand } from '../src/commands/estate';

it('counts a sentence parser failure, writes the map, and continues to later sentences', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prose-failure-'));
  await writeFile(
    join(root, 'CLAUDE.md'),
    'The helper must trigger a parser failure.\n\nThe helper must validate the manifest.\n',
  );
  let output = '';
  const io = {
    cwd: root,
    out(text: string) {
      output += text;
    },
    err(text: string) {
      throw new Error(text);
    },
  };
  expect(await estateScanCommand('.', { model: false, out: 'map.yaml' }, io)).toBe(0);
  expect(output).toContain('Code-found prose candidates skipped: 1.');
  expect(output).toContain('injected sentence parser failure');
  const loaded = await loadEstateMap(join(root, 'map.yaml'));
  expect(
    loaded.ok &&
      loaded.map.atoms.some((atom) => atom.provenance.quote === 'The helper must validate the manifest.'),
  ).toBe(true);
});
