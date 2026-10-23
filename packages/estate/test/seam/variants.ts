import { posix } from 'node:path';
import type { Files, PartRef } from './observe';

/**
 * Variant generators for the seam tests. Each one builds a small invented estate from AXES (where the naming part
 * lives, how a path is written, how far it reaches, its case, line ending and size), so a rule is tested on a
 * matrix and never on one shape. Names are invented from a seeded syllable table: no name, path or structure of
 * any real estate is used. A part is known to the tests by an opaque id (`namer`, `target`, `entry`, `module`),
 * never by its path.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Invented names

/** A small deterministic generator (mulberry32): the same seed gives the same estate. */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYLLABLES = [
  'ba',
  'ko',
  'ri',
  'tem',
  'vul',
  'sen',
  'dor',
  'mi',
  'lax',
  'pho',
  'qua',
  'zel',
  'nor',
  'tis',
];

/** An invented lower-case word that no reader gives a meaning to. */
export function word(next: () => number, syllables = 3): string {
  let out = '';
  for (let i = 0; i < syllables; i += 1) out += SYLLABLES[Math.floor(next() * SYLLABLES.length)] ?? 'ba';
  return out;
}

export type Casing = 'lower' | 'upper-stem' | 'mixed';
export const CASINGS: readonly Casing[] = ['lower', 'upper-stem', 'mixed'];
export type Eol = 'lf' | 'crlf';

export function cased(stem: string, casing: Casing): string {
  if (casing === 'upper-stem') return stem.toUpperCase();
  if (casing === 'mixed') return stem.charAt(0).toUpperCase() + stem.slice(1);
  return stem;
}

/** Joins path pieces, dropping empty ones, so a root-level part has no leading slash. */
export const join = (...pieces: string[]) => posix.join(...pieces.filter((piece) => piece !== ''));

export function text(lines: readonly string[], eol: Eol): string {
  return `${lines.join(eol === 'crlf' ? '\r\n' : '\n')}${eol === 'crlf' ? '\r\n' : '\n'}`;
}

export const PLAIN_BODY = ['Keep replies short.', 'Ask before deleting anything.'];

export function skillFile(name: string, body: readonly string[]): string[] {
  return ['---', `name: ${name}`, `description: Handles ${name} work for the team.`, '---', '', ...body];
}

/** Extra skills that name nothing: the size axis. Each holds a body and one document, with no path in any line. */
export function junk(files: Files, count: number, next: () => number): void {
  for (let i = 0; i < count; i += 1) {
    const name = `${word(next, 2)}${i}`;
    files[`.claude/skills/${name}/SKILL.md`] = text(skillFile(name, PLAIN_BODY), 'lf');
    files[`.claude/skills/${name}/extra-${i}.md`] = text(['# Extra', 'Plain notes.'], 'lf');
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Fix 2: a path a part's text writes is a reference

export type Syntax = 'code-span' | 'link' | 'link-anchor' | 'link-spaced' | 'table-cell' | 'quoted' | 'bare';
export const SYNTAXES: readonly Syntax[] = [
  'code-span',
  'link',
  'link-anchor',
  'link-spaced',
  'table-cell',
  'quoted',
  'bare',
];
export type Namer = 'standing' | 'skill-body' | 'skill-doc' | 'agent-body' | 'memory';
export type Reach = 'sibling' | 'child' | 'parent' | 'from-root' | 'from-root-layout';
export type StandingFile = 'CLAUDE.md' | '.claude/CLAUDE.md' | 'CLAUDE.local.md';
export const STANDING_FILES: readonly StandingFile[] = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'];
export const EXTENSIONS = ['.md', '.txt', '.json', '.csv', ''] as const;

/** The (naming part, reach) pairs that name a real place. */
export const PLACES: ReadonlyArray<readonly [Namer, Reach]> = [
  ['standing', 'sibling'],
  ['standing', 'child'],
  ['skill-body', 'sibling'],
  ['skill-body', 'child'],
  ['skill-body', 'from-root'],
  ['skill-body', 'from-root-layout'],
  ['skill-doc', 'sibling'],
  ['skill-doc', 'parent'],
  ['skill-doc', 'child'],
  ['skill-doc', 'from-root'],
  ['agent-body', 'from-root'],
  ['memory', 'from-root'],
];

export type RefAxes = {
  namer: Namer;
  reach: Reach;
  syntax: Syntax;
  /** Does the named file exist? */
  exists: boolean;
  casing: Casing;
  eol: Eol;
  standing: StandingFile;
  extension: (typeof EXTENSIONS)[number];
  /** Number of unrelated skills added. */
  size: number;
  /** Written with a leading `./`. */
  dot: boolean;
};

export type RefMods = Partial<{
  /** Lines of unrelated text above the naming line. */
  preamble: boolean;
  /** The naming line sits in a fenced code block. */
  fenced: boolean;
  /** The naming line is replaced by a sentence that names nothing. */
  omitNaming: boolean;
  /** The naming line is written twice. */
  duplicate: boolean;
  exists: boolean;
  syntax: Syntax;
  casing: Casing;
  eol: Eol;
  size: number;
  /** Folder names to nest the estate root in. */
  nest: readonly string[];
}>;

export type Built = {
  label: string;
  files: Files;
  parts: PartRef[];
  /** The target sits under `.claude/`, where every file is read: an unnamed target is an orphan. */
  orphanObservable: boolean;
  nest?: readonly string[];
};

function mention(syntax: Syntax, written: string): string[] {
  switch (syntax) {
    case 'code-span':
      return [`Before acting, read \`${written}\` first.`];
    case 'link':
      return [`Before acting, read [the notes](${written}) first.`];
    case 'link-anchor':
      return [`Before acting, read [the notes](${written}#second-part) first.`];
    case 'link-spaced':
      return [`Before acting, read [the notes](<${written}>) first.`];
    case 'table-cell':
      return ['| Case | Read |', '|---|---|', `| unsure | \`${written}\` |`];
    case 'quoted':
      return [`Before acting, read "${written}" first.`];
    case 'bare':
      return [`Before acting, read ${written} first.`];
  }
}

/** What a read must do with a mention, from the syntax that wrote it alone. */
export type Behaviour = {
  /** When the named file exists: a link, or nothing (the notation makes it no path: a lone word). */
  exists: 'link' | 'none';
  /**
   * When it does not: `fails` (a missing reference), `listed` (kept apart, listed by the check as skipped with its
   * reason), or `silent` (a loose word, which asks the reader to read no file).
   */
  missing: 'fails' | 'listed' | 'silent';
};

const LINKS: readonly Syntax[] = ['link', 'link-anchor', 'link-spaced'];

/**
 * The rule, written from how a path is told from a word. A path is a path by its syntax: a name with a file
 * extension, a link destination, or a delimited name that holds a folder separator. A path is missing for certain
 * when it has a file extension, is a link destination, or is written as `../x`; a delimited name with a separator and
 * no extension whose first folder the estate does not hold (`yes/no`) is kept apart and listed. A loose word that
 * names nothing asks the reader to read no file.
 */
export function behaviour(axes: Pick<RefAxes, 'syntax' | 'reach' | 'extension' | 'dot'>): Behaviour {
  const link = LINKS.includes(axes.syntax);
  const separator = axes.reach !== 'sibling' || axes.dot;
  if (axes.extension !== '') {
    // A loose word with no separator could be any word: a missing one is asserted neither way.
    const bareWord = axes.syntax === 'bare' && !separator;
    return { exists: 'link', missing: bareWord ? 'silent' : 'fails' };
  }
  // No file extension: only a link destination, or a delimited name with a separator, is a path.
  if (axes.syntax === 'bare') return { exists: separator ? 'link' : 'none', missing: 'silent' };
  if (link) return { exists: 'link', missing: 'fails' };
  if (!separator) return { exists: 'none', missing: 'silent' };
  // Certain: written as a relative path (`../x`, `./x`), or from a folder every estate of this runtime holds.
  const certain = axes.reach === 'parent' || axes.reach === 'from-root-layout' || axes.dot;
  return { exists: 'link', missing: certain ? 'fails' : 'listed' };
}

export function referenceEstate(axes: RefAxes, mods: RefMods = {}, seed = 7): Built {
  const next = rng(seed);
  const exists = mods.exists ?? axes.exists;
  const syntax = mods.syntax ?? axes.syntax;
  const casing = mods.casing ?? axes.casing;
  const eol = mods.eol ?? axes.eol;
  const skill = word(next);
  const agent = word(next);
  const memory = word(next);
  const doc = word(next);
  const sub = word(next, 2);
  const stem = cased(word(next), casing);
  const file = `${stem}${axes.extension}`;
  const written = (path: string) => (axes.dot && !path.startsWith('.') ? `./${path}` : path);

  const files: Files = {};
  let namerPath: string;
  let folder: string;
  switch (axes.namer) {
    case 'standing':
      namerPath = axes.standing;
      folder = posix.dirname(namerPath) === '.' ? '' : posix.dirname(namerPath);
      break;
    case 'skill-body':
      namerPath = `.claude/skills/${skill}/SKILL.md`;
      folder = `.claude/skills/${skill}`;
      break;
    case 'skill-doc':
      namerPath = `.claude/skills/${skill}/references/${doc}.md`;
      folder = `.claude/skills/${skill}/references`;
      break;
    case 'agent-body':
      namerPath = `.claude/agents/${agent}.md`;
      folder = '.claude/agents';
      break;
    case 'memory':
      namerPath = `.claude/memory/${memory}.md`;
      folder = '.claude/memory';
      break;
  }
  const spaced = syntax === 'link-spaced';
  const name = spaced ? `${stem} ${word(next, 2)}${axes.extension}` : file;
  let targetPath: string;
  let how: string;
  switch (axes.reach) {
    case 'sibling':
      targetPath = join(folder, name);
      how = written(name);
      break;
    case 'child':
      targetPath = join(folder, sub, name);
      how = written(`${sub}/${name}`);
      break;
    case 'parent':
      targetPath = join(posix.dirname(folder), name);
      how = `../${name}`;
      break;
    case 'from-root':
      targetPath = join(sub, name);
      how = `${sub}/${name}`;
      break;
    case 'from-root-layout':
      targetPath = join('.claude/skills', skill, sub, name);
      how = targetPath;
      break;
  }

  let naming = mention(syntax, how);
  if (mods.duplicate) naming = [...naming, '', ...naming];
  if (mods.fenced) naming = ['```text', ...naming, '```'];
  if (mods.omitNaming) naming = ['Before acting, think it over first.'];
  const lead = mods.preamble ? ['# Preface', '', 'A short preface.', '', '', ''] : [];
  const body = [...lead, ...PLAIN_BODY, '', ...naming, '', 'Thank you.'];

  switch (axes.namer) {
    case 'standing':
      files[namerPath] = text(['# Rules', '', ...body], eol);
      break;
    case 'skill-body':
      files[namerPath] = text(skillFile(skill, body), eol);
      break;
    case 'skill-doc':
      files[`.claude/skills/${skill}/SKILL.md`] = text(skillFile(skill, PLAIN_BODY), 'lf');
      files[namerPath] = text(['# Notes', '', ...body], eol);
      break;
    case 'agent-body':
      files[namerPath] = text(
        [
          '---',
          `name: ${agent}`,
          `description: Checks records for the ${agent} team.`,
          'tools: Read',
          '---',
          '',
          ...body,
        ],
        eol,
      );
      break;
    case 'memory':
      files[namerPath] = text(['# Memory', '', ...body], eol);
      break;
  }
  if (axes.namer !== 'standing') files['CLAUDE.md'] = text(['# Rules', '', ...PLAIN_BODY], 'lf');
  if (exists) files[targetPath] = text(['# Target', 'Plain notes.'], 'lf');
  junk(files, mods.size ?? axes.size, next);

  const parts: PartRef[] = [
    { id: 'namer', path: namerPath },
    { id: 'target', path: targetPath },
  ];
  return {
    label: `${axes.namer}/${axes.reach}/${syntax}/${exists ? 'exists' : 'missing'}/${casing}/${eol}/${axes.standing}/${axes.extension}/${axes.size}${axes.dot ? '/dot' : ''}`,
    files,
    parts,
    orphanObservable: targetPath.startsWith('.claude/'),
    ...(mods.nest ? { nest: mods.nest } : {}),
  };
}

/**
 * The matrix of the reference rule: every (naming part, reach) pair, every syntax, a named file that exists and
 * one that does not. The other axes cycle with the index, so each value of each axis meets many others.
 */
export function referenceMatrix(): RefAxes[] {
  const out: RefAxes[] = [];
  let i = 0;
  for (const [namer, reach] of PLACES) {
    for (const syntax of SYNTAXES) {
      for (const exists of [true, false]) {
        out.push({
          namer,
          reach,
          syntax,
          exists,
          casing: CASINGS[i % CASINGS.length] ?? 'lower',
          eol: (i >> 1) % 2 === 0 ? 'lf' : 'crlf',
          standing: STANDING_FILES[i % STANDING_FILES.length] ?? 'CLAUDE.md',
          extension: EXTENSIONS[i % EXTENSIONS.length] ?? '.md',
          size: i % 17 === 0 ? 40 : i % 5 === 0 ? 6 : 0,
          dot: (reach === 'sibling' || reach === 'child') && i % 3 === 0,
        });
        i += 1;
      }
    }
  }
  return out;
}

/** Text that looks like a path and is none, or names a place that is not a file. Each must give no reference. */
export const DECOYS: ReadonlyArray<{ key: string; lines: string[] }> = [
  { key: 'fenced-example', lines: ['```text', 'Read `notes/gone-a.md` first.', '```'] },
  { key: 'url', lines: ['See https://example.org/guide/gone-b.md for background.'] },
  { key: 'url-link', lines: ['Background is in [the guide](https://example.org/gone-c.md).'] },
  { key: 'glob', lines: ['Read `notes/*.md` for each case.'] },
  { key: 'placeholder', lines: ['Write the answer to `out/<date>.md`.'] },
  { key: 'versions', lines: ['Use release v1.2.3 or e.g. Node.js 22 and approx. five.'] },
  { key: 'ratio', lines: ['Read/write access is needed; and/or ask first.'] },
  { key: 'tool-name', lines: ['Load the `invoice-check` skill, then the `Read` tool.'] },
  { key: 'command', lines: ['Run `git status --short` before you start.'] },
];

export function decoyEstate(lines: readonly string[], eol: Eol = 'lf'): Built {
  return {
    label: 'decoy',
    files: { 'CLAUDE.md': text(['# Rules', '', ...PLAIN_BODY, '', ...lines], eol) },
    parts: [{ id: 'namer', path: 'CLAUDE.md' }],
    orphanObservable: false,
  };
}
