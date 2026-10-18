import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEstateMap } from '../src/index';
import { sha256 } from '../src/scan/text';

const MAPS = ['fixture/approved.yaml', 'reader-cases/map.yaml'].map((path) =>
  fileURLToPath(new URL(`../../../examples/estates/${path}`, import.meta.url)),
);

const folders: string[] = [];
afterEach(async () => {
  while (folders.length > 0) await rm(folders.pop() ?? '', { recursive: true, force: true });
});
async function fresh(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-map-cache-'));
  folders.push(dir);
  return dir;
}

describe('the JSON cache of a parsed map', () => {
  it.each(MAPS)('gives the same map from the cache as from the YAML: %s', async (path) => {
    const cacheDir = await fresh();
    const plain = await loadEstateMap(path);
    const first = await loadEstateMap(path, { cacheDir });
    const text = await readFile(path, 'utf8');
    expect(await readdir(cacheDir)).toEqual([`${sha256(text)}.json`]);
    const second = await loadEstateMap(path, { cacheDir });
    if (!plain.ok || !first.ok || !second.ok) throw new Error('a load failed');
    expect(first.map).toEqual(plain.map);
    expect(second.map).toEqual(plain.map);
    expect(JSON.stringify(second.map)).toBe(JSON.stringify(plain.map));
  });

  it('reads the copy when the text is the same, and never a copy of another text', async () => {
    const cacheDir = await fresh();
    const dir = await fresh();
    const path = join(dir, 'map.yaml');
    const text = await readFile(MAPS[1] as string, 'utf8');
    await writeFile(path, text);
    await loadEstateMap(path, { cacheDir });
    // Approval is not hashed: a copy that says otherwise proves the copy is what was read.
    const cached = join(cacheDir, `${sha256(text)}.json`);
    const copy = JSON.parse(await readFile(cached, 'utf8'));
    copy.atoms[0].approved = !copy.atoms[0].approved;
    await writeFile(cached, JSON.stringify(copy));
    const fromCopy = await loadEstateMap(path, { cacheDir });
    expect(fromCopy.ok && fromCopy.map.atoms[0]?.approved).toBe(copy.atoms[0].approved);
    // One byte more in the text: another key, parsed from the YAML.
    await writeFile(path, `${text}\n`);
    const edited = await loadEstateMap(path, { cacheDir });
    expect(edited.ok && edited.map.atoms[0]?.approved).toBe(!copy.atoms[0].approved);
    expect((await readdir(cacheDir)).sort()).toEqual(
      [`${sha256(text)}.json`, `${sha256(`${text}\n`)}.json`].sort(),
    );
  });

  it('parses the YAML again over a copy that is not JSON or fails the checks, and replaces it', async () => {
    const cacheDir = await fresh();
    const path = MAPS[1] as string;
    const cached = join(cacheDir, `${sha256(await readFile(path, 'utf8'))}.json`);
    await loadEstateMap(path, { cacheDir });
    await writeFile(cached, '{ not json');
    expect((await loadEstateMap(path, { cacheDir })).ok).toBe(true);
    const copy = JSON.parse(await readFile(cached, 'utf8'));
    copy.atoms[0].provenance.quote = 'an edited quote';
    await writeFile(cached, JSON.stringify(copy));
    const loaded = await loadEstateMap(path, { cacheDir });
    expect(loaded.ok && loaded.map.atoms[0]?.provenance.quote).not.toBe('an edited quote');
    expect(JSON.parse(await readFile(cached, 'utf8')).atoms[0].provenance.quote).not.toBe('an edited quote');
  });
});
