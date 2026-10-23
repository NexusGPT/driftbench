import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Files, place } from './claude-layout';
import { cleanup, observe, write } from './harness';
import { specOf, type UnitKey } from './spec';

afterEach(cleanup);

/**
 * Rule (parts kept out, everywhere the reader walks): what keeps a part out of the setup keeps it out in the three
 * places the reader looks: inside the runtime's layout folder, beside it (an instruction file in a folder of the
 * project), and where a document names a path. A rule that names folders only hides a folder and not a link to
 * one (git does not call a link a folder); a rule that names a name hides both. A folder a tool tagged as a cache
 * is no one's, however the reader came to it.
 */

const STANDING = (folder: string) => `app/${folder}/CLAUDE.md`;
const TEXT = '# Notes\n\nAlways keep the totals in whole cents.\n';
const SEEDS = [3, 8, 14];
const TAG = 'Signature: 8a477f597d28d172789f06886806bc55\n# A cache.\n';

type Form = {
  name: string;
  hides: boolean;
  /** Files that keep `app/<folder>/CLAUDE.md` out, or leave it in, for a folder name. */
  files(folder: string): Files;
};

const FORMS: Form[] = [
  { name: 'a rule that names folders only', hides: true, files: (f) => ({ '.gitignore': `${f}/\n` }) },
  { name: 'a rule that names the name', hides: true, files: (f) => ({ '.gitignore': `${f}\n` }) },
  { name: 'an anchored rule', hides: true, files: (f) => ({ '.gitignore': `/app/${f}/\n` }) },
  { name: 'a rule in the folder above', hides: true, files: (f) => ({ 'app/.gitignore': `${f}/\n` }) },
  { name: 'a folder tagged as a cache', hides: true, files: (f) => ({ [`app/${f}/CACHEDIR.TAG`]: TAG }) },
  {
    name: 'a folder tagged as a cache, with a rule that brings it back',
    hides: true,
    files: (f) => ({ [`app/${f}/CACHEDIR.TAG`]: TAG, '.gitignore': `!${f}/\n` }),
  },
  {
    name: 'a rule for another folder (control)',
    hides: false,
    files: () => ({ '.gitignore': 'elsewhere/\n' }),
  },
  {
    name: 'a rule that brings the folder back (control)',
    hides: false,
    files: (f) => ({ '.gitignore': `app/*/\n!app/${f}/\n` }),
  },
  {
    name: 'a tag of another signature (control)',
    hides: false,
    files: (f) => ({ [`app/${f}/CACHEDIR.TAG`]: 'Signature: 0\n' }),
  },
  { name: 'no tag (control)', hides: false, files: () => ({}) },
];

function setup(seed: number, form: Form, folder: string) {
  const placed = place(specOf(seed, 0));
  const key: UnitKey = 'standing:beside';
  const files: Files = { ...placed.files, [STANDING(folder)]: TEXT, ...form.files(folder) };
  return { files, paths: new Map(placed.paths).set(key, STANDING(folder)), key };
}

describe('an instruction file beside the layout folder is kept out as a part inside it is', () => {
  for (const form of FORMS) {
    for (const seed of SEEDS) {
      it(`${form.hides ? 'hides' : 'keeps'} it: ${form.name} (seed ${seed})`, async () => {
        const { files, paths, key } = setup(seed, form, 'scratch');
        const obs = await observe(await write(files), paths);
        expect(obs.isRead(key)).toBe(!form.hides);
        if (form.hides) {
          expect(obs.reachedLabeler(key)).toBe(false);
          expect(obs.isCopied(key)).toBe(false);
        }
      });
    }
  }
});

describe('a path a document names is kept out as a part found by the walk is', () => {
  const NAMED = (folder: string) => `Read \`${folder}/notes.md\` before you start.\n`;

  async function named(seed: number, files: Files) {
    const placed = place(specOf(seed, 0));
    const standing = `${placed.files['CLAUDE.md']}\n${NAMED('quarrycache')}`;
    const all = { ...placed.files, 'CLAUDE.md': standing, 'quarrycache/notes.md': TEXT, ...files };
    const paths = new Map(placed.paths).set('named:notes', 'quarrycache/notes.md');
    return observe(await write(all), paths);
  }

  it.each(SEEDS)('reads the named file when nothing keeps it out (seed %i)', async (seed) => {
    const obs = await named(seed, {});
    expect(obs.isRead('named:notes')).toBe(true);
  });

  it.each(SEEDS)('does not read the named file in a folder tagged as a cache (seed %i)', async (seed) => {
    const obs = await named(seed, { 'quarrycache/CACHEDIR.TAG': TAG });
    expect(obs.isRead('named:notes')).toBe(false);
    expect(obs.reachedLabeler('named:notes')).toBe(false);
  });

  it.each(SEEDS)('does not read the named file in a folder an ignore file names (seed %i)', async (seed) => {
    const obs = await named(seed, { '.gitignore': 'quarrycache/\n' });
    expect(obs.isRead('named:notes')).toBe(false);
  });

  it.each(SEEDS)('does not read the named file when a folder above it is tagged (seed %i)', async (seed) => {
    const placed = place(specOf(seed, 0));
    const standing = `${placed.files['CLAUDE.md']}\nRead \`ferrule/deep/notes.md\` before you start.\n`;
    const files = {
      ...placed.files,
      'CLAUDE.md': standing,
      'ferrule/deep/notes.md': TEXT,
      'ferrule/CACHEDIR.TAG': TAG,
    };
    const paths = new Map(placed.paths).set('named:deep', 'ferrule/deep/notes.md');
    const obs = await observe(await write(files), paths);
    expect(obs.isRead('named:deep')).toBe(false);
  });
});

describe('a link to a folder is not a folder for a rule that names folders only', () => {
  /** A folder `shared` of the project holding a note, linked as `<where>/scratch`. */
  async function linked(seed: number, rule: string, where: 'beside' | 'inside') {
    const placed = place(specOf(seed, 0));
    const cap = [...placed.paths.entries()].find(([key]) => key.startsWith('capability:'));
    const home = where === 'beside' ? 'app' : `${dirname(cap?.[1] ?? '.claude/skills/x/SKILL.md')}`;
    const note = where === 'beside' ? 'CLAUDE.md' : 'notes.md';
    const files: Files = { ...placed.files, [`shared/${note}`]: TEXT, '.gitignore': `${rule}\n` };
    const root = await write(files);
    await mkdir(join(root, home), { recursive: true });
    const up = '../'.repeat(home.split('/').length);
    await symlink(`${up}shared`, join(root, home, 'scratch'));
    await writeFile(join(root, 'marker'), '');
    const key: UnitKey = 'linked:note';
    return observe(root, new Map(placed.paths).set(key, `${home}/scratch/${note}`)).then((obs) => ({
      obs,
      key,
    }));
  }

  for (const where of ['beside', 'inside'] as const) {
    it.each(SEEDS)(
      `keeps the part under a link when the rule names folders only, ${where} the layout (seed %i)`,
      async (seed) => {
        const { obs, key } = await linked(seed, 'scratch/', where);
        expect(obs.isRead(key)).toBe(true);
      },
    );

    it.each(SEEDS)(
      `hides the part under a link when the rule names the name, ${where} the layout (seed %i)`,
      async (seed) => {
        const { obs, key } = await linked(seed, 'scratch', where);
        expect(obs.isRead(key)).toBe(false);
      },
    );
  }
});
