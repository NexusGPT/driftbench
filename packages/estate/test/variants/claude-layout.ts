import { type CapUnit, capKey, junkKey, type RefUnit, refKey, type Spec, spell, type UnitKey } from './spec';

/**
 * The one file that knows where a Claude Code setup keeps its parts and how its files are written. A spec
 * (spec.ts) names no path; this module places each unit and writes its text. A test that wants another runtime
 * brings another module with the same exports and keeps its expectations.
 */

export type Files = Record<string, string>;

const SKILLS = '.claude/skills';
const fileOf = (stem: string, spelling: RefUnit['stored']) => `${spell(stem, spelling)}.md`;

export type Placed = {
  files: Files;
  /** Where each unit lies on the disk, relative to the root. */
  paths: Map<UnitKey, string>;
};

export function capFolder(cap: CapUnit, base = SKILLS): string {
  return `${base}/${cap.name}`;
}

export function capText(cap: CapUnit, extra: readonly string[] = []): string {
  return [
    '---',
    `name: ${cap.name}`,
    `description: Handle the ${cap.name} chores. Use when the user asks for the ${cap.name} chores.`,
    '---',
    '',
    `# ${cap.name}`,
    '',
    'Always keep the totals in whole cents.',
    '',
    ...cap.links.map((link) => `For the details open \`references/${fileOf(link.ref, link.written)}\`.`),
    ...extra,
    '',
  ].join('\n');
}

export function standingText(spec: Spec): string {
  const rows = spec.caps.map((cap) => `| handle the ${cap.name} chores | \`${cap.name}\` |`);
  return [
    '# Standing',
    '',
    'Keep every answer short.',
    ...(rows.length > 0
      ? ['', '## Routing', '', '| When the user wants to | Load |', '|---|---|', ...rows]
      : []),
    '',
  ].join('\n');
}

/** The files of a spec, the capabilities under `base`, the standing file routing to each of them. */
export function place(spec: Spec, base = SKILLS): Placed {
  const files: Files = { 'CLAUDE.md': standingText(spec) };
  const paths = new Map<UnitKey, string>([['instruction:main', 'CLAUDE.md']]);
  for (const cap of spec.caps) {
    const skill = `${capFolder(cap, base)}/SKILL.md`;
    files[skill] = capText(cap);
    paths.set(capKey(cap), skill);
    for (const ref of cap.refs) {
      const path = `${capFolder(cap, base)}/references/${fileOf(ref.stem, ref.stored)}`;
      files[path] = `# ${ref.stem}\n\nThe ${ref.stem} notes are kept here.\n`;
      paths.set(refKey(cap, ref), path);
    }
  }
  return { files, paths };
}

// A part kept out of the setup ---------------------------------------------------------------------------------

/** A draft nobody links, that points at a part that does not exist: read, it would be an unresolved link. */
export const DRAFT =
  '# Draft\n\nAlways keep the totals in whole cents.\nSee `references/vanished-notes.md`.\n';

export type Junk = { key: UnitKey; path: string; folder: string; files: Files };

/** The draft of a capability, in its `scratch` folder. */
export function junkOf(cap: CapUnit): Junk {
  const folder = capFolder(cap);
  const path = `${folder}/scratch/wip-draft.md`;
  return { key: junkKey(cap), path, folder, files: { [path]: DRAFT } };
}

/**
 * One way a part stays out of the setup, or in it: the files that do it, the path of the part it is about, and
 * whether the part stays out. A form is a rule an owner writes (an ignore file, the setup file), a place the
 * runtime does not read from (a copy of its own layout folder), or a tool's mark (a cache tag). The controls
 * are forms that look like these and are not, so the part stays in.
 */
export type Hiding = {
  name: string;
  hides: boolean;
  build(cap: CapUnit): { path: string; folder: string; files: Files };
};

function byRule(name: string, hides: boolean, files: (junk: Junk) => Files): Hiding {
  return {
    name,
    hides,
    build: (cap) => {
      const junk = junkOf(cap);
      return { path: junk.path, folder: junk.folder, files: { ...junk.files, ...files(junk) } };
    },
  };
}

const RULES: Hiding[] = [
  byRule('a name in the root ignore file', true, (j) => ({ '.gitignore': `${j.path}\n` })),
  byRule('a glob on the file name', true, () => ({ '.gitignore': '*-draft.md\n' })),
  byRule('a folder with a trailing slash', true, () => ({ '.gitignore': 'scratch/\n' })),
  byRule('an anchored glob over folders', true, () => ({ '.gitignore': '/.claude/skills/*/scratch/\n' })),
  byRule('a glob across folders', true, () => ({ '.gitignore': '**/scratch\n' })),
  byRule('a comment, a blank line and a name', true, (j) => ({
    '.gitignore': `# local notes\n\n${j.path}\n`,
  })),
  byRule('an ignore file inside the unit folder', true, (j) => ({
    [`${j.folder}/.gitignore`]: 'scratch/\n',
  })),
  byRule('a later line that brings the part back', false, (j) => ({
    '.gitignore': `*-draft.md\n!${j.path.split('/').pop()}\n`,
  })),
  byRule('the setup file (the control that holds today)', true, () => ({
    'driftbench.estate.yaml': 'ignore:\n  - scratch\n',
  })),
];

/** Places inside the layout folder where a copy of the layout folder may lie. */
const NESTED_AT = (cap: CapUnit) => ['skills', `skills/${cap.name}`, 'agents', 'hooks/lib', 'memory/topics'];

const NESTED: Hiding[] = [0, 1, 2, 3, 4].flatMap((index): Hiding[] => {
  const where = (cap: CapUnit) => NESTED_AT(cap)[index] as string;
  const at = (cap: CapUnit, folder: string) => {
    const path = `.claude/${where(cap)}/${folder}/ledger-notes/draft.md`;
    return { path, folder: `.claude/${where(cap)}`, files: { [path]: DRAFT } };
  };
  const label = [
    'inside the skills folder',
    'inside a skill folder',
    'inside the agents folder',
    'deep in the hooks folder',
    'inside the memory folder',
  ][index];
  return [
    {
      name: `a copy of the layout folder ${label}`,
      hides: true,
      build: (cap) => at(cap, '.claude'),
    },
    {
      name: `a folder named like the layout folder but not equal to it ${label} (control)`,
      hides: false,
      build: (cap) => at(cap, '.claude-notes'),
    },
  ];
});

/** The tag a tool writes in a folder it fills with a cache (the Cache Directory Tagging Specification). */
export const CACHE_TAG =
  'Signature: 8a477f597d28d172789f06886806bc55\n# This file is a cache directory tag.\n';

const CACHE_FOLDERS = [
  '.claude/hooks/quarrycache',
  '.claude/skills/.windlass-cache',
  '.claude/hooks/lib/out/ferrulecache',
];

const CACHES: Hiding[] = CACHE_FOLDERS.flatMap((folder, index): Hiding[] => {
  const build = (tag: string | undefined) => (_cap: CapUnit) => {
    const path = `${folder}/notes.md`;
    return {
      path,
      folder,
      files: { [path]: DRAFT, ...(tag === undefined ? {} : { [`${folder}/CACHEDIR.TAG`]: tag }) },
    };
  };
  return [
    { name: `a folder tagged as a cache, form ${index + 1}`, hides: true, build: build(CACHE_TAG) },
    {
      name: `the same folder with no tag (control), form ${index + 1}`,
      hides: false,
      build: build(undefined),
    },
    {
      name: `the same folder with a tag of another signature (control), form ${index + 1}`,
      hides: false,
      build: build('Signature: 0000\n'),
    },
  ];
});

export const HIDINGS: Hiding[] = [...RULES, ...NESTED, ...CACHES];

/** Parts the runtime always loads: a local instruction and a local setting. They stay read whatever is kept out. */
export const ALWAYS_LOADED: Array<{ key: UnitKey; path: string; text: string }> = [
  { key: 'instruction:local', path: 'CLAUDE.local.md', text: '# Local\n\nKeep every answer short.\n' },
  {
    key: 'setting:local',
    path: '.claude/settings.local.json',
    text: '{ "permissions": { "allow": ["Read"] } }\n',
  },
];

// A second source of capabilities --------------------------------------------------------------------------------

export const DANGLING = ['See `references/vanished-notes.md` for the details.'];

/** A capability with one defect of each kind (nothing names its file; one link names no part), under `base`. */
export function defectiveCap(
  cap: CapUnit,
  base: string,
): { files: Files; looseKey: UnitKey; loosePath: string } {
  const loosePath = `${base}/${cap.name}/references/loose.md`;
  return {
    files: {
      [`${base}/${cap.name}/SKILL.md`]: capText(cap, DANGLING),
      [loosePath]: '# Loose\n\nNothing names this file.\n',
    },
    looseKey: `reference:${cap.name}:loose`,
    loosePath,
  };
}

/** The atom that stands for the capability in a map, for its name: where the map says the part was read. */
export function capAtomFile(
  atoms: ReadonlyArray<{
    kind: string;
    fields?: Record<string, unknown> | undefined;
    provenance: { file: string };
  }>,
  cap: CapUnit,
): string | undefined {
  return atoms.find((atom) => atom.kind === 'skill' && atom.fields?.name === cap.name)?.provenance.file;
}
