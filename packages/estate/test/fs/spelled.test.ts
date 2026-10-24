import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isSpelledOnDisk, statSpelled } from '../../src/fs/estate-fs';
import { ClaudeCodeReader, copyEstate, mutateEstate, scanEstate } from '../../src/index';
import { NOW, structurePointer } from '../support';

const made: string[] = [];
afterEach(async () => {
  while (made.length > 0) await rm(made.pop() ?? '', { recursive: true, force: true });
});

async function folder(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-spelled-'));
  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** Whether this disk keeps the case of a name: `a` and `A` are two files on Linux and one on a Mac. */
async function keepsCase(): Promise<boolean> {
  const root = await folder({ a: 'x' });
  return (await stat(join(root, 'A')).catch(() => undefined)) === undefined;
}

const SKILL =
  '---\nname: gantry-roster\ndescription: Plan the gantry roster.\n---\n\nAlways keep the roster in whole shifts.\n';

describe('a name is a file only in the letters the folder listing holds', () => {
  it('spells a path as the listing does, on a disk that keeps case and on one that does not', async () => {
    const root = await folder({ 'docs/Notes.md': '# Notes\n' });
    expect(await isSpelledOnDisk(root, 'docs/Notes.md')).toBe(true);
    expect(await isSpelledOnDisk(root, 'docs/notes.md')).toBe(false);
    expect(await isSpelledOnDisk(root, 'Docs/Notes.md')).toBe(false);
    expect(await isSpelledOnDisk(root, 'docs/./Notes.md')).toBe(true);
    expect(await isSpelledOnDisk(root, 'docs/Missing.md')).toBe(false);
    expect(await isSpelledOnDisk(root, '.')).toBe(true);
  });

  it('stats a file only under its exact spelling', async () => {
    const root = await folder({ 'docs/Notes.md': '# Notes\n' });
    expect((await statSpelled(root, 'docs/Notes.md'))?.isFile()).toBe(true);
    expect(await statSpelled(root, 'docs/NOTES.md')).toBeUndefined();
  });

  it('reads a root file by name in exact case: a standing file in other letters is not the standing file', async () => {
    const root = await folder({ 'claude.md': '# Rules\n' });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.files.map((file) => file.path)).not.toContain('CLAUDE.md');
  });

  it('holds both spellings when the disk holds both, and reads the one a name spells', async (context) => {
    if (!(await keepsCase())) context.skip();
    const root = await folder({
      'CLAUDE.md': '# Rules\n\nRead `References/ferrule.md` first.\n',
      'References/ferrule.md': '# Upper folder\n',
      'references/ferrule.md': '# Lower folder\n',
    });
    expect(await isSpelledOnDisk(root, 'References/ferrule.md')).toBe(true);
    expect(await isSpelledOnDisk(root, 'references/ferrule.md')).toBe(true);
  });
});

describe('a mutant copy holds the names of the estate and reports any other change as collateral', () => {
  async function copied() {
    const root = await folder({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/gantry-roster/SKILL.md': SKILL,
      '.claude/skills/gantry-roster/references/ferrule-notes.md': '# Ferrule notes\n',
      '.claude/skills/gantry-roster/references/notes.md': '# Notes\n\nThe origin is in `FERRULE-NOTES.md`.\n',
    });
    const { map } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    const to = await mkdtemp(join(tmpdir(), 'driftbench-spelled-copy-'));
    made.push(to);
    await copyEstate(root, to, map);
    return { root, to, map };
  }

  it('copies by the names the disk lists', async () => {
    const { to } = await copied();
    expect(await readdir(join(to, '.claude/skills/gantry-roster/references'))).toEqual([
      'ferrule-notes.md',
      'notes.md',
    ]);
  });

  it('lists as collateral a file the copy holds under a name the estate does not, and one changed beyond the span', async () => {
    const { root, to, map } = await copied();
    const route = map.atoms.find((atom) => atom.kind === 'route');
    expect(route).toBeDefined();
    const clean = await mutateEstate({ root: to, map, source: root }, { delete: route?.id ?? '' });
    expect(clean.collateral).toEqual([]);

    const again = await copied();
    const other = again.map.atoms.find((atom) => atom.kind === 'route');
    await writeFile(
      join(again.to, '.claude/skills/gantry-roster/references/notes.md'),
      '# Notes\n\nChanged.\n',
    );
    await mkdir(join(again.to, 'extra'), { recursive: true });
    await writeFile(join(again.to, 'extra/Stray.md'), '# Stray\n');
    const dirty = await mutateEstate(
      { root: again.to, map: again.map, source: again.root },
      { delete: other?.id ?? '' },
    );
    expect(dirty.collateral).toEqual([
      'file-changed .claude/skills/gantry-roster/references/notes.md',
      'file-not-in-estate extra/Stray.md',
    ]);
  });

  it('refuses to mutate a file the copy holds in other letters', async () => {
    const { root, to, map } = await copied();
    const route = map.atoms.find((atom) => atom.kind === 'route');
    const shifted = {
      ...map,
      atoms: map.atoms.map((atom) =>
        atom.id === route?.id
          ? {
              ...atom,
              provenance: { ...atom.provenance, file: atom.provenance.file.replace('SKILL.md', 'skill.md') },
            }
          : atom,
      ),
    };
    await expect(
      mutateEstate({ root: to, map: shifted, source: root }, { delete: route?.id ?? '' }),
    ).rejects.toThrow(/not in the estate copy/);
  });
});
