import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { copyEstate, type EstateMap, loadEstateMap, MutantError, mutateEstate } from '../../src/index';

/**
 * An estate whose files are symbolic links to a real folder elsewhere, as an estate kept in a dotfiles
 * repository is. A mutant must never write through a link into the real files: the copy holds real files,
 * and every write checks that its target stays inside the copy.
 */

const FIXTURE = fileURLToPath(new URL('../../../../examples/estates/fixture/', import.meta.url));
const R3 = 'gate.standing.read-before-edit-it';
const ROUTE = 'route.invoice-reconcile.an-ask-that-fits-invoice-reconcile';

let map: EstateMap;
beforeAll(async () => {
  const loaded = await loadEstateMap(join(FIXTURE, 'approved.yaml'));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  map = loaded.map;
});

const folders: string[] = [];
afterEach(async () => {
  while (folders.length > 0) await rm(folders.pop() ?? '', { recursive: true, force: true });
});

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  folders.push(dir);
  return dir;
}

/** Every file under a folder with the SHA-256 of its bytes, links followed. */
async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (at: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else
        out[relative(dir, full)] = createHash('sha256')
          .update(await readFile(full))
          .digest('hex');
    }
  };
  await walk(dir);
  return out;
}

async function links(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (at: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if ((await lstat(full)).isSymbolicLink()) out.push(relative(dir, full));
      else if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(dir);
  return out;
}

/** A real folder holding CLAUDE.md and .claude/skills, and an estate whose CLAUDE.md and .claude/skills link to it. */
async function linkedEstate(): Promise<{ real: string; estate: string }> {
  const real = await temp('estate-real-');
  await cp(join(FIXTURE, 'CLAUDE.md'), join(real, 'CLAUDE.md'));
  await cp(join(FIXTURE, '.claude', 'skills'), join(real, 'skills'), { recursive: true });
  const estate = await temp('estate-linked-');
  await cp(join(FIXTURE, '.claude'), join(estate, '.claude'), { recursive: true });
  await rm(join(estate, '.claude', 'skills'), { recursive: true });
  await symlink(join(real, 'skills'), join(estate, '.claude', 'skills'));
  await symlink(join(real, 'CLAUDE.md'), join(estate, 'CLAUDE.md'));
  return { real, estate };
}

describe('mutants of an estate made of symbolic links', () => {
  it('copies real files, never a link, and leaves the real folder byte-identical after both mutations', async () => {
    const { real, estate } = await linkedEstate();
    const before = await tree(real);
    const to = await temp('mutant-');
    await copyEstate(estate, to, map);
    expect(await links(to)).toEqual([]);
    await mutateEstate({ root: to, map }, { delete: R3 });
    await mutateEstate({ root: to, map }, { delete: ROUTE });
    expect(await readFile(join(to, 'CLAUDE.md'), 'utf8')).not.toContain('Read a file before you edit it.');
    expect(await tree(real)).toEqual(before);
  });

  it('refuses to write through a link that leaves the copy, and names the path', async () => {
    const { real } = await linkedEstate();
    const to = await temp('mutant-');
    await copyEstate(FIXTURE, to, map);
    await rm(join(to, 'CLAUDE.md'));
    await symlink(join(real, 'CLAUDE.md'), join(to, 'CLAUDE.md'));
    const before = await tree(real);
    const attempt = mutateEstate({ root: to, map }, { delete: R3 });
    await expect(attempt).rejects.toBeInstanceOf(MutantError);
    await expect(attempt).rejects.toThrow(`CLAUDE.md resolves to ${await realpath(join(real, 'CLAUDE.md'))}`);
    expect(await tree(real)).toEqual(before);
  });

  it('refuses a folder on the way that links out of the copy', async () => {
    const { real } = await linkedEstate();
    const to = await temp('mutant-');
    await copyEstate(FIXTURE, to, map);
    await rm(join(to, '.claude', 'skills'), { recursive: true });
    await mkdir(join(to, '.claude'), { recursive: true });
    await symlink(join(real, 'skills'), join(to, '.claude', 'skills'));
    const before = await tree(real);
    await expect(mutateEstate({ root: to, map }, { delete: ROUTE })).rejects.toThrow('outside the copy');
    expect(await tree(real)).toEqual(before);
  });
});
