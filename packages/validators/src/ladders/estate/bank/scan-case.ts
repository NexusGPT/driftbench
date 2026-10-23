import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  copyEstate,
  type EstateMap,
  mutateEstate,
  readerFor,
  scanEstate,
} from '@agent-nexus/driftbench-estate';
import { RUNTIME, SETTINGS, STANDING, skillFile } from '../layout';
import { writeEstate } from '../pipeline';
import { namesFor, plantSkill } from './common';
import type { ItemResult, Tier } from './frame';
import { type Case, standardSkill } from './hostile';
import { BASE, type Check } from './planted';

/**
 * bench.defects, case items: a name written in other letters than the file it means. A reference names `FERRULE-NOTES.md`, the
 * file on the disk is `ferrule-notes.md`. A disk that ignores case (a Mac) opens the file under both spellings; a
 * disk that keeps it (Linux) does not. The estate must read the same on both: a name is looked up against the
 * folder listing with exact case, so one file has one path, and a copy of the estate holds the names the disk
 * holds. The oracle: the files the scan read have each one path (no two differ only in case), no file is read
 * under the other spelling, and a mutant copy lists the names its source lists.
 */

const READER = 'packages/estate/src/scan/claude-code.ts';
const MUTATE = 'packages/estate/src/mutants/mutate.ts';
const CAUSE = 'look a named file up against the folder listing with exact case, so one file has one path';

/** The files the scan read, none of them twice under spellings that differ only in case. */
function onePathPerFile(scan: Parameters<Check>[0]): string | undefined {
  const seen = new Map<string, string>();
  for (const file of scan.raw.files) {
    const key = file.path.toLowerCase();
    const earlier = seen.get(key);
    if (earlier !== undefined && earlier !== file.path)
      return `one file is read under two spellings, ${earlier} and ${file.path}`;
    seen.set(key, file.path);
  }
  return undefined;
}

/** The file the scan read under the spelling a reference wrote, which the disk does not hold. */
function notReadAs(spelling: string): Check {
  return (scan) =>
    scan.raw.files.some((file) => file.path === spelling || file.path.endsWith(`/${spelling}`))
      ? `${spelling} is read as a file, but the disk holds it in other letters`
      : undefined;
}

function caseCase(
  key: string,
  tier: Tier,
  title: string,
  plant: (path: (relative: string) => string, skill: string) => Array<[path: string, text: string]>,
  spelling: string,
): Case {
  return {
    key,
    tier,
    title,
    component: READER,
    cause: CAUSE,
    plant: (e, s, o) => {
      const names = standardSkill(e, s, o);
      for (const [path, text] of plant((relative) => skillFile(names.skill, relative), names.skill))
        e.raw(path, text, BASE);
      e.check(o, onePathPerFile);
      e.check(o, notReadAs(spelling));
    },
  };
}

const CASES: Case[] = [
  caseCase(
    'case-name-in-reference-folder',
    2,
    'a reference file naming an upper-case file that sits beside it in lower case',
    (path) => [
      [path('references/ferrule-notes.md'), '# Ferrule notes\n\nKept by the harbor team.\n'],
      [path('references/notes.md'), '# Notes\n\nThe origin is in `FERRULE-NOTES.md`.\n'],
    ],
    'FERRULE-NOTES.md',
  ),
  {
    key: 'case-name-in-skill-folder',
    tier: 2,
    title: 'a skill body naming an upper-case file that sits beside it in lower case',
    component: READER,
    cause: CAUSE,
    plant: (e, s, o) => {
      const names = namesFor(s, o);
      plantSkill(
        e,
        BASE,
        names.skill,
        'Checks things.',
        [{ text: 'Always name the record first.' }, { text: 'The origin is in `FERRULE-NOTES.md`.' }],
        { id: o },
      );
      e.raw(
        skillFile(names.skill, 'ferrule-notes.md'),
        '# Ferrule notes\n\nKept by the harbor team.\n',
        BASE,
      );
      e.check(o, onePathPerFile);
      e.check(o, notReadAs('FERRULE-NOTES.md'));
    },
  },
  {
    key: 'case-name-at-root',
    tier: 2,
    title: 'a standing file naming an upper-case file at the root that is there in lower case',
    component: READER,
    cause: CAUSE,
    plant: (e, s, o) => {
      standardSkill(e, s, o);
      e.file(STANDING, BASE).lines_(['', 'Read `HARBOR-RULES.md` before editing the roster.']);
      e.raw('harbor-rules.md', '# Harbor rules\n\nEvery rule has one owner.\n', BASE);
      e.check(o, onePathPerFile);
      e.check(o, notReadAs('HARBOR-RULES.md'));
    },
  },
  caseCase(
    'case-upper-file-named-in-lower',
    3,
    'a reference naming in lower case a file the disk holds in upper case',
    (path) => [
      [path('references/FERRULE-NOTES.md'), '# Ferrule notes\n\nKept by the harbor team.\n'],
      [path('references/notes.md'), '# Notes\n\nThe origin is in `ferrule-notes.md`.\n'],
    ],
    'ferrule-notes.md',
  ),
];

/** The files of a folder, as the disk spells them, relative to it. */
async function listing(folder: string, from = folder): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) out.push(...(await listing(path, from)));
    else out.push(relative(from, path));
  }
  return out.sort();
}

async function mutantKeepsNames(seed: number): Promise<ItemResult> {
  const names = namesFor(seed, 'scan.case.mutant');
  const skill = (path: string) => skillFile(names.skill, path);
  const rule = `Always name the ${names.noun} in the first line.`;
  const root = await writeEstate({
    [STANDING]: '# Planted estate\n',
    [SETTINGS]: '{}\n',
    [skill('SKILL.md')]:
      `---\nname: ${names.skill}\ndescription: Checks things.\n---\n\n# ${names.skill}\n\n${rule}\n`,
    [skill('references/ferrule-notes.md')]: '# Ferrule notes\n\nKept by the harbor team.\n',
    [skill('references/notes.md')]: '# Notes\n\nThe origin is in `FERRULE-NOTES.md`.\n',
  });
  const to = await mkdtemp(join(tmpdir(), 'driftbench-estate-case-'));
  try {
    const reader = readerFor(RUNTIME);
    if (!reader) throw new Error(`no reader for ${RUNTIME}`);
    const map: EstateMap = (
      await scanEstate({
        root,
        reader,
        port: { family: 'recording', model: 'none', complete: async () => '{"atoms":[]}' },
        now: () => new Date('2026-10-11T00:00:00.000Z'),
      })
    ).map;
    const source = await listing(root);
    const listed = (await reader.listFiles?.(root)) ?? [];
    const unnamed = listed.filter((file) => !source.includes(file));
    if (unnamed.length > 0)
      return {
        pass: false,
        detail: `the scan lists ${unnamed.join(', ')}, which the estate does not hold by that name`,
      };
    await copyEstate(root, to, map);
    const copied = await listing(to);
    const strangers = copied.filter((file) => !source.includes(file));
    if (strangers.length > 0)
      return {
        pass: false,
        detail: `the estate copy holds ${strangers.join(', ')}, which the estate does not`,
      };
    const target = map.atoms.find(
      (atom) => atom.provenance.file === skill('SKILL.md') && atom.kind === 'route',
    );
    if (!target) return { pass: false, detail: 'the scan gave no route atom to mutate' };
    const result = await mutateEstate({ root: to, map, source: root }, { delete: target.id });
    if (result.collateral.length > 0)
      return {
        pass: false,
        detail: `the mutant changed more than its span: ${result.collateral.join(', ')}`,
      };
    const after = await listing(to);
    const changed = after.filter((file) => !source.includes(file));
    if (changed.length > 0)
      return {
        pass: false,
        detail: `the mutant copy holds ${changed.join(', ')}, which the estate does not`,
      };
    return { pass: true, detail: 'holds' };
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  }
}

/** The case items that plant an estate and read the scan. */
export function caseCases(): Case[] {
  return CASES;
}

/** The case item that copies and mutates an estate on a disk. */
export function caseRuns(): Array<{
  key: string;
  tier: Tier;
  title: string;
  component: string;
  cause: string;
  run(seed: number): Promise<ItemResult>;
}> {
  return [
    {
      key: 'case-mutant-copy-keeps-names',
      tier: 3,
      title:
        'a mutant copy of an estate whose reference spells a file in other letters holds the names of the disk',
      component: MUTATE,
      cause:
        'copy a mutant by the names the disk lists, and report any file the copy changes beyond the span',
      run: mutantKeepsNames,
    },
  ];
}
