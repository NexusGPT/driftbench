import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeCodeReader, copyEstate, mutateEstate, scanEstate } from '../../src/index';
import { isSpelledOnDisk } from '../../src/paths';
import { estate, NOW, structurePointer } from '../support';

const skill =
  '---\nname: dock-roster\ndescription: Plan the dock roster.\n---\n\nAlways keep the roster in whole shifts.\n';

const folders: string[] = [];
afterEach(async () => {
  while (folders.length > 0) await rm(folders.pop() ?? '', { recursive: true, force: true });
});

/** Whether this disk keeps the case of a name: `a` and `A` are two files on Linux and one on a Mac. */
async function keepsCase(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-case-'));
  folders.push(dir);
  await writeFile(join(dir, 'a'), 'x');
  return (await stat(join(dir, 'A')).catch(() => undefined)) === undefined;
}

async function scan(files: Record<string, string>) {
  const root = await estate(files);
  folders.push(root);
  const result = await scanEstate({
    root,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: structurePointer(),
  });
  return { root, ...result };
}

const reads = (paths: readonly string[], pattern: RegExp) => paths.filter((path) => pattern.test(path));

describe('a name is looked up against the folder listing with exact case', () => {
  it('spells a path as the listing does, on a disk that keeps case and on one that does not', async () => {
    const root = await estate({ 'docs/Notes.md': '# Notes\n' });
    folders.push(root);
    expect(await isSpelledOnDisk(root, 'docs/Notes.md')).toBe(true);
    expect(await isSpelledOnDisk(root, 'docs/notes.md')).toBe(false);
    expect(await isSpelledOnDisk(root, 'Docs/Notes.md')).toBe(false);
    expect(await isSpelledOnDisk(root, 'docs/./Notes.md')).toBe(true);
    expect(await isSpelledOnDisk(root, 'docs/Missing.md')).toBe(false);
  });

  it('reads a reference to an upper-case name beside a lower-case file as one file, never two', async () => {
    const { raw, map } = await scan({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/dock-roster/SKILL.md': skill,
      '.claude/skills/dock-roster/references/vendored.md': '# Vendored\n\nCopied from the shared kit.\n',
      '.claude/skills/dock-roster/references/notes.md': '# Notes\n\nThe origin is in `VENDORED.md`.\n',
    });
    const paths = raw.files.map((file) => file.path);
    expect(reads(paths, /vendored\.md$/i)).toEqual(['.claude/skills/dock-roster/references/vendored.md']);
    expect(new Set(paths.map((path) => path.toLowerCase())).size).toBe(paths.length);
    // The name is missing, as it is on a disk that keeps case.
    const named = map.atoms.filter(
      (atom) => atom.kind === 'reference' && JSON.stringify(atom.fields).includes('VENDORED'),
    );
    expect(named.every((atom) => atom.fields?.exists !== true)).toBe(true);
  });

  it('does the same for a standing file naming an upper-case file at the root', async () => {
    const { raw } = await scan({
      'CLAUDE.md': '# Rules\n\nRead `AGENTS.md` before editing the shared kit.\n',
      '.claude/skills/dock-roster/SKILL.md': skill,
      'agents.md': '# Agents\n\nThe shared kit has one owner.\n',
    });
    expect(
      reads(
        raw.files.map((file) => file.path),
        /agents\.md$/i,
      ),
    ).toEqual([]);
  });

  it('lists the files of an estate under the names the disk holds', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/dock-roster/SKILL.md': skill,
      '.claude/skills/dock-roster/references/vendored.md': '# Vendored\n',
      '.claude/skills/dock-roster/references/notes.md': '# Notes\n\nSee `VENDORED.md`.\n',
    });
    folders.push(root);
    const listed = await new ClaudeCodeReader().listFiles(root);
    expect(reads(listed, /vendored\.md$/i)).toEqual(['.claude/skills/dock-roster/references/vendored.md']);
  });

  it('reads the file a name spells exactly when the disk holds both spellings', async (context) => {
    if (!(await keepsCase())) context.skip();
    const { raw } = await scan({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/dock-roster/SKILL.md': skill,
      '.claude/skills/dock-roster/references/VENDORED.md': '# Upper\n\nCopied from the shared kit.\n',
      '.claude/skills/dock-roster/references/vendored.md': '# Lower\n\nCopied from the other kit.\n',
      '.claude/skills/dock-roster/references/notes.md': '# Notes\n\nThe origin is in `VENDORED.md`.\n',
    });
    const paths = raw.files.map((file) => file.path);
    expect(reads(paths, /vendored\.md$/i).sort()).toEqual([
      '.claude/skills/dock-roster/references/VENDORED.md',
      '.claude/skills/dock-roster/references/vendored.md',
    ]);
  });
});

describe('a mutant copy holds the names of the estate', () => {
  async function copied() {
    const { root, map } = await scan({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/dock-roster/SKILL.md': skill,
      '.claude/skills/dock-roster/references/vendored.md': '# Vendored\n\nCopied from the shared kit.\n',
      '.claude/skills/dock-roster/references/notes.md': '# Notes\n\nThe origin is in `VENDORED.md`.\n',
    });
    const to = await mkdtemp(join(tmpdir(), 'driftbench-copy-'));
    folders.push(to);
    await copyEstate(root, to, map);
    return { root, to, map };
  }

  it('copies by the names the disk lists', async () => {
    const { to } = await copied();
    expect(await readdir(join(to, '.claude/skills/dock-roster/references'))).toEqual([
      'notes.md',
      'vendored.md',
    ]);
  });

  it('reports a file the copy holds under a name the estate does not, and one changed beyond the span', async () => {
    const { root, to, map } = await copied();
    const route = map.atoms.find((atom) => atom.kind === 'route');
    expect(route).toBeDefined();
    const clean = await mutateEstate({ root: to, map, source: root }, { delete: route?.id ?? '' });
    expect(clean.collateral).toEqual([]);

    const again = await copied();
    const other = again.map.atoms.find((atom) => atom.kind === 'route');
    await writeFile(
      join(again.to, '.claude/skills/dock-roster/references/notes.md'),
      '# Notes\n\nChanged.\n',
    );
    await mkdir(join(again.to, 'extra'), { recursive: true });
    await writeFile(join(again.to, 'extra/Stray.md'), '# Stray\n');
    const dirty = await mutateEstate(
      { root: again.to, map: again.map, source: again.root },
      { delete: other?.id ?? '' },
    );
    expect(dirty.collateral).toEqual([
      'file .claude/skills/dock-roster/references/notes.md: changed beyond the mutated span',
      'file extra/Stray.md: not in the estate under that name',
    ]);
  });
});
