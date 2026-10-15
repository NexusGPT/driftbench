import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHash, loadSpecs } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

/**
 * The frozen sealed holdouts under examples/acme/gated. `driftbench gate` wrote each seal before the block
 * redesign keys existed (`uses`, `compare`, links, provenance), and each seal pins the content hash of one sealed
 * spec: the cache keys, the cell ids, carry and re-judge all hold that hash. examples/acme/gated and
 * examples/acme/golden are frozen copies that no feature PR regenerates, so every sealed spec must load with none
 * of the new keys and to the exact hash its seal pinned.
 */

const ACME = fileURLToPath(new URL('../', import.meta.url));
const SEALS = ['gated/holdout/seal.json', 'gated/control-handwritten/holdout/seal.json'];
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const FROZEN_TREES = ['examples/acme/gated', 'examples/acme/golden'];

// These byte hashes were captured from main, independently of the mutable seals below.
// Never regenerate this fixture to accommodate a feature change or a reseal.
const PIN = new URL('./fixtures/frozen-trees.sha256.json', import.meta.url);

async function byteHashes(directory: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  const entries = await readdir(join(REPO, directory), { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(hashes, await byteHashes(path));
    else
      hashes[path] = createHash('sha256')
        .update(await readFile(join(REPO, path)))
        .digest('hex');
  }
  return hashes;
}

type Seal = { specs: Array<{ id: string; path: string; hash: string }> };

describe('the sealed holdout specs, frozen before the block redesign', () => {
  it('preserves every byte and path in both frozen trees against independent SHA-256 pins', async () => {
    const { files: pinned } = JSON.parse(await readFile(PIN, 'utf8')) as {
      files: Record<string, string>;
    };
    const actual = Object.assign({}, ...(await Promise.all(FROZEN_TREES.map(byteHashes)))) as Record<
      string,
      string
    >;
    const differences: string[] = [];
    for (const path of [...new Set([...Object.keys(pinned), ...Object.keys(actual)])].sort()) {
      if (!(path in pinned)) differences.push(`added: ${path}`);
      else if (!(path in actual)) differences.push(`removed: ${path}`);
      else if (actual[path] !== pinned[path]) differences.push(`changed: ${path}`);
    }
    expect(differences, `Frozen snapshot drift:\n${differences.join('\n')}`).toEqual([]);
  });

  it('load with no compare and no uses key, to the hash their seal pinned', async () => {
    let checked = 0;
    let withInputs = 0;
    for (const file of SEALS) {
      const seal = JSON.parse(await readFile(join(ACME, file), 'utf8')) as Seal;
      const root = join(ACME, dirname(file), '..');
      for (const entry of seal.specs) {
        const [loaded] = await loadSpecs([join(root, entry.path)]);
        expect(loaded?.ok, entry.path).toBe(true);
        if (!loaded?.ok) continue;
        expect(JSON.stringify(loaded.spec), entry.id).not.toContain('"compare"');
        expect(JSON.stringify(loaded.spec), entry.id).not.toContain('"uses"');
        expect(contentHash(loaded.spec), entry.id).toBe(entry.hash);
        expect(loaded.hash, entry.id).toBe(entry.hash);
        checked += 1;
        const tools = loaded.spec.blocks.flatMap((block) => block.expect?.tools ?? []);
        if (tools.some((tool) => Object.keys(tool.input ?? {}).length > 0)) withInputs += 1;
      }
    }
    expect(checked).toBe(58);
    // Some of them assert tool input values, the values a value check decides: their hash still holds.
    expect(withInputs).toBeGreaterThan(0);
  });
});
