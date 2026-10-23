import { posix } from 'node:path';
import type { Files, PartRef } from './observe';
import {
  type Built,
  type Eol,
  join,
  PLAIN_BODY,
  rng,
  STANDING_FILES,
  type StandingFile,
  text,
  word,
} from './variants';

// ---------------------------------------------------------------------------------------------------------------------
// Fix 6: an `@` import of a standing file

export type ImportForm = 'own-line' | 'inline' | 'list-item' | 'dot-relative' | 'escaped-space';
export const IMPORT_FORMS: readonly ImportForm[] = [
  'own-line',
  'inline',
  'list-item',
  'dot-relative',
  'escaped-space',
];
/** Where the imported file stands, from the importing file: beside it, in a folder below it, or at the estate root only. */
export type ImportPlace = 'same-folder' | 'below' | 'root-only';
export type ImportTarget = 'exists' | 'missing' | 'outside-home' | 'outside-absolute';

export type ImportAxes = {
  importer: StandingFile;
  form: ImportForm;
  place: ImportPlace;
  target: ImportTarget;
  /** Number of files between the importer and the last file (0 = the importer names the last file). */
  depth: number;
  eol: Eol;
};

export type ImportMods = Partial<{
  preamble: boolean;
  /** Put the importing line in a code span, a fenced block, or write its path quoted. */
  decoy: 'code-span' | 'fenced' | 'quoted';
  /** Move the importer to another standing file, leaving the written path as it is. */
  importer: StandingFile;
  /** Delete the last imported file. */
  deleteLast: boolean;
  nest: readonly string[];
  cycle: boolean;
}>;

export type ImportBuilt = Built & { chain: string[]; lastId: string };

export function importEstate(axes: ImportAxes, mods: ImportMods = {}, seed = 11): ImportBuilt {
  const next = rng(seed);
  const importer = mods.importer ?? axes.importer;
  // A folder name with a space needs the backslash form in the written import.
  const rules = axes.form === 'escaped-space' ? `${word(next, 2)} ${word(next, 2)}` : word(next, 2);
  const names = Array.from({ length: axes.depth + 1 }, () => `${word(next)}.md`);
  // The files stand where the original importer's folder puts them; a moved importer leaves them there.
  const importerFolder = posix.dirname(axes.importer) === '.' ? '' : posix.dirname(axes.importer);
  // Where the files stand: below the importer's folder, beside the importer, or (root-only) under the estate root
  // while the import is written from the importer's own folder.
  const folder =
    axes.place === 'below'
      ? join(importerFolder, rules)
      : axes.place === 'root-only'
        ? rules
        : importerFolder;
  const writtenDir = axes.place === 'same-folder' ? '' : rules;
  const backslashSpaces = (value: string) => value.replace(/ /g, '\\ ');

  let first: string;
  if (axes.target === 'outside-home') first = `~/${word(next, 2)}/${names[0]}`;
  else if (axes.target === 'outside-absolute') first = `/opt/${word(next, 2)}/${names[0]}`;
  else first = join(writtenDir, names[0] ?? '');
  const escaped = axes.form === 'escaped-space' ? backslashSpaces(first) : first;
  const written = axes.form === 'dot-relative' && !/^[~/]/.test(escaped) ? `./${escaped}` : escaped;

  const at = `@${written}`;
  let line: string[];
  switch (mods.decoy) {
    case 'code-span':
      line = [`To mention a file without importing it, write \`${at}\` as text.`];
      break;
    case 'fenced':
      line = ['```text', at, '```'];
      break;
    case 'quoted':
      line = [`- notes @"${first}"`];
      break;
    default:
      line =
        axes.form === 'inline'
          ? [`See ${at} for the details.`]
          : axes.form === 'list-item'
            ? [`- team conventions ${at}`]
            : [at];
  }
  const lead = mods.preamble ? ['# Preface', '', 'A short preface.', '', '', ''] : [];
  const files: Files = {};
  files[importer] = text(['# Rules', '', ...lead, ...PLAIN_BODY, '', ...line, '', 'Thank you.'], axes.eol);

  // The chain: each file imports the next by a name beside it. Nothing of it stands in the estate when the first
  // import leads outside or the last file is deleted.
  const parts: PartRef[] = [{ id: 'namer', path: importer }];
  const chain: string[] = [];
  const inside = axes.target === 'exists' || axes.target === 'missing';
  if (inside) {
    for (let i = 0; i <= axes.depth; i += 1) {
      const last = i === axes.depth;
      if (last && (axes.target === 'missing' || mods.deleteLast)) break;
      const lines = last
        ? ['# Conventions', '', '- Keep replies short.']
        : ['# Conventions', '', `@${names[i + 1] ?? ''}`];
      if (mods.cycle && last) lines.push(`@${names[0] ?? ''}`);
      const path = join(folder, names[i] ?? '');
      const id = last ? 'last' : `i${i + 1}`;
      files[path] = text(lines, 'lf');
      parts.push({ id, path });
      chain.push(id);
    }
  }
  return {
    label: `${importer}/${axes.form}/${axes.place}/${axes.target}/d${axes.depth}/${axes.eol}${mods.decoy ? `/${mods.decoy}` : ''}`,
    files,
    parts,
    orphanObservable: false,
    chain,
    lastId: chain[chain.length - 1] ?? 'namer',
    ...(mods.nest ? { nest: mods.nest } : {}),
  };
}

export function importMatrix(): ImportAxes[] {
  const out: ImportAxes[] = [];
  let i = 0;
  for (const importer of STANDING_FILES) {
    for (const form of IMPORT_FORMS) {
      for (const place of ['same-folder', 'below', 'root-only'] as const) {
        for (const target of ['exists', 'missing', 'outside-home', 'outside-absolute'] as const) {
          if (target !== 'exists' && place === 'root-only') continue;
          out.push({ importer, form, place, target, depth: i % 4, eol: i % 2 === 0 ? 'lf' : 'crlf' });
          i += 1;
        }
      }
    }
  }
  return out;
}
