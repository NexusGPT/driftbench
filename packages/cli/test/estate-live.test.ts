import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEstateMap } from '@driftbench/estate';
import { afterEach, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

/** `driftbench estate mutate` and `estate run` on the fictional Northwind fixture, with the fake headless command. */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const MAP = join(FIXTURE, 'approved.yaml');
const R3 = 'gate.standing.read-a-file-before-editing-it';
const R7 = 'instruction.standing.tell-the-user-about-a-late';

async function run(argv: string[], cwd = ROOT) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

const folders: string[] = [];
afterEach(async () => {
  while (folders.length > 0) await rm(folders.pop() ?? '', { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'estate-live-'));
  folders.push(dir);
  return dir;
}

describe('driftbench estate mutate', () => {
  it('writes the estate copy with the atom deleted, its map and the mutant record', async () => {
    const to = join(await folder(), 'mutant');
    const result = await run(['estate', 'mutate', MAP, '--atom', R3, '--delete', '--to', to]);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain(`Mutant: delete ${R3} in CLAUDE.md.`);
    expect((await readdir(to)).sort()).toEqual(['.claude', 'CLAUDE.md', 'map.yaml', 'mutant.json']);
    expect(await readFile(join(to, 'CLAUDE.md'), 'utf8')).not.toContain('Read a file before you edit it.');
    const record = JSON.parse(await readFile(join(to, 'mutant.json'), 'utf8'));
    const mutantMap = await loadEstateMap(join(to, 'map.yaml'));
    expect(mutantMap.ok).toBe(true);
    if (!mutantMap.ok) return;
    expect(record).toMatchObject({ atom: R3, op: 'delete', file: 'CLAUDE.md', mapHash: mutantMap.map.hash });
    const original = await loadEstateMap(MAP);
    expect(original.ok && record.originalMapHash === original.map.hash).toBe(true);
    expect(record.mapHash).not.toBe(record.originalMapHash);
  });

  it('inverts an obligation and prints the line before and after', async () => {
    const to = join(await folder(), 'mutant');
    const result = await run(['estate', 'mutate', MAP, '--atom', R7, '--invert', '--to', to, '--json']);
    expect(result.code).toBe(0);
    const record = JSON.parse(result.out);
    expect(record.after).toContain('do not tell the user');
  });

  it('refuses a missing or double mutation, an unknown atom, a quote it cannot invert, and an occupied folder', async () => {
    const base = await folder();
    const to = join(base, 'mutant');
    expect((await run(['estate', 'mutate', MAP, '--atom', R3, '--to', to])).code).toBe(2);
    expect(
      (await run(['estate', 'mutate', MAP, '--atom', R3, '--delete', '--invert', '--to', to])).code,
    ).toBe(2);
    const unknown = await run(['estate', 'mutate', MAP, '--atom', 'no.such', '--delete', '--to', to]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('not in the map');
    const json = await run([
      'estate',
      'mutate',
      MAP,
      '--atom',
      'tool.settings.deny-webfetch',
      '--invert',
      '--to',
      to,
    ]);
    expect(json.code).toBe(2);
    expect(json.err).toContain('delete it instead');
    expect(await readdir(base)).toEqual([]);
    const occupied = join(base, 'occupied');
    await run(['estate', 'mutate', MAP, '--atom', R3, '--delete', '--to', occupied]);
    expect((await run(['estate', 'mutate', MAP, '--atom', R7, '--invert', '--to', occupied])).code).toBe(2);
    const replaced = await run([
      'estate',
      'mutate',
      MAP,
      '--atom',
      R7,
      '--invert',
      '--to',
      occupied,
      '--force',
    ]);
    expect(replaced.code).toBe(0);
    const stranger = join(base, 'stranger');
    await rm(stranger, { recursive: true, force: true });
    await (await import('node:fs/promises')).mkdir(stranger);
    await writeFile(join(stranger, 'notes.txt'), 'keep me\n');
    expect(
      (await run(['estate', 'mutate', MAP, '--atom', R3, '--delete', '--to', stranger, '--force'])).code,
    ).toBe(2);
    expect(await readFile(join(stranger, 'notes.txt'), 'utf8')).toBe('keep me\n');
  });
});
