import { readFile, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';

/**
 * Ignore files, read as an ignore file is read: a `.gitignore`-style file keeps files out of the estate. One
 * file applies to the folder it lies in and below it; a later line wins over an earlier one and a deeper file
 * over a higher one; a line that starts with `!` brings a file back; a file inside an ignored folder stays
 * ignored whatever a later line says. Case is exact, as everywhere in the estate.
 *
 * The format is the one git documents: blank lines and `#` comments carry nothing, a trailing space goes unless
 * escaped, a slash at the end means folders only, a slash at the start or in the middle ties the glob to the
 * folder of the file, `*` and `?` stop at a slash, `[a-z]` is a class, `**` crosses folders, `\` escapes.
 */

/** A line of an ignore file. */
export type IgnoreLine = {
  /** The line as written, trimmed. */
  text: string;
  negated: boolean;
  /** The line names folders only (a trailing slash). */
  foldersOnly: boolean;
  /** The glob is tied to the folder of the file (a slash at the start or in the middle). */
  anchored: boolean;
  test(path: string): boolean;
};

const MAX_BYTES = 1024 * 1024;

/** A code point as a regular expression escape, valid inside and outside a class with the `u` flag. */
const point = (char: string): string => `\\u{${(char.codePointAt(0) ?? 0).toString(16)}}`;

/** The members of the POSIX classes a bracket may name, as ranges of the ASCII table (git's own `ctype`). */
const POSIX_CLASSES: Readonly<Record<string, string>> = {
  alnum: '0-9A-Za-z',
  alpha: 'A-Za-z',
  blank: ' \\t',
  cntrl: '\\u{0}-\\u{1f}\\u{7f}',
  digit: '0-9',
  graph: '!-~',
  lower: 'a-z',
  print: ' -~',
  punct: '!-\\/:-@\\[-`{-~',
  space: ' \\t\\n\\r',
  upper: 'A-Z',
  xdigit: '0-9A-Fa-f',
};

/** A bracket expression read from `chars[at]` (the `[`): its regular expression, and where it ends. */
type Bracket = { source: string | undefined; end: number };

/**
 * A bracket expression as git's wildmatch reads it. `!` or `^` right after `[` negates; the first `]` after
 * that (or after `[`) is a member, not the end; `a-z` is a range, and a range whose ends are reversed holds only its first
 * character; `\x` is the member `x`; `[:alpha:]` is a named class; a `-` first or last is itself. A class never
 * matches `/`. A bracket never closed, or a class name git does not know, makes the whole glob match nothing:
 * `source` is then undefined.
 */
function bracket(chars: readonly string[], at: number): Bracket {
  let index = at + 1;
  let negated = false;
  if (chars[index] === '!' || chars[index] === '^') {
    negated = true;
    index++;
  }
  const members: string[] = [];
  let previous: string | undefined;
  let first = true;
  for (;;) {
    let char = chars[index];
    if (char === undefined) return { source: undefined, end: chars.length };
    if (char === ']' && !first) break;
    first = false;
    if (char === '\\') {
      char = chars[++index];
      if (char === undefined) return { source: undefined, end: chars.length };
      members.push(point(char));
      previous = char;
    } else if (
      char === '-' &&
      previous !== undefined &&
      chars[index + 1] !== undefined &&
      chars[index + 1] !== ']'
    ) {
      let high = chars[++index] as string;
      if (high === '\\') {
        high = chars[++index] as string;
        if (high === undefined) return { source: undefined, end: chars.length };
      }
      // The start of the range is a member on its own (git compares it first); a reversed range adds nothing more.
      if ((previous.codePointAt(0) ?? 0) <= (high.codePointAt(0) ?? 0))
        members.push(`${point(previous)}-${point(high)}`);
      previous = undefined;
    } else if (char === '[' && chars[index + 1] === ':') {
      const close = chars.indexOf(']', index + 2);
      if (close < 0) return { source: undefined, end: chars.length };
      if (chars[close - 1] === ':' && close - 1 >= index + 2) {
        const name = chars.slice(index + 2, close - 1).join('');
        const range = POSIX_CLASSES[name];
        if (range === undefined) return { source: undefined, end: chars.length };
        members.push(range);
        previous = undefined;
        index = close;
      } else {
        // No `:]` closes it: the `[` is a member like any other.
        members.push(point('['));
        previous = char;
      }
    } else {
      members.push(point(char));
      previous = char;
    }
    index++;
  }
  const set = members.length > 0 ? `[${members.join('')}]` : undefined;
  const source = negated ? `(?!/)${set ? `(?!${set})` : ''}[\\s\\S]` : set ? `(?!/)${set}` : '(?!)';
  return { source, end: index };
}

/**
 * A glob as the source of a regular expression on one path from the folder of the file, or undefined when git
 * reads the glob as one that matches nothing (a trailing backslash, a bracket never closed, an unknown class
 * name). Written so that no glob makes an invalid expression: every character outside a class is escaped, every
 * member of a class is a code point.
 */
export function globSource(glob: string): string | undefined {
  const chars = Array.from(glob);
  let source = '';
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index] as string;
    if (char === '*') {
      let run = 1;
      while (chars[index + run] === '*') run++;
      const after = chars[index + run];
      // A run of stars that is a whole component (`**` between slashes, or at an end) crosses folders.
      const component = (index === 0 || chars[index - 1] === '/') && (after === undefined || after === '/');
      if (component && run >= 2 && after === '/') {
        source += '(?:[^/]+/)*';
        index += run;
      } else if (component && run >= 2) {
        source += '.+';
        index += run - 1;
      } else {
        source += '[^/]*';
        index += run - 1;
      }
    } else if (char === '?') source += '[^/]';
    else if (char === '[') {
      const read = bracket(chars, index);
      if (read.source === undefined) return undefined;
      source += read.source;
      index = read.end;
    } else if (char === '\\') {
      const next = chars[++index];
      if (next === undefined) return undefined;
      source += point(next);
    } else source += point(char);
  }
  return source;
}

/** The lines of one ignore file, in file order. */
export function parseIgnoreFile(text: string): IgnoreLine[] {
  const lines: IgnoreLine[] = [];
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\) +$/, '');
    if (line === '' || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    if (negated) line = line.slice(1);
    // One trailing slash says "folders only"; a second one stays in the glob, which then matches nothing.
    const foldersOnly = line.endsWith('/');
    const glob = foldersOnly ? line.slice(0, -1) : line;
    if (glob === '') continue;
    const anchored = glob.includes('/');
    const source = globSource(glob.startsWith('/') ? glob.slice(1) : glob);
    // A glob git reads as one that matches nothing is kept as a line that matches nothing.
    const regex = source === undefined ? undefined : new RegExp(`^${source}$`, 'u');
    lines.push({
      text: raw.trim(),
      negated,
      foldersOnly,
      anchored,
      test: (path) => regex?.test(anchored ? path : posix.basename(path)) ?? false,
    });
  }
  return lines;
}

/**
 * The ignore files of an estate, found by name in each folder the reader enters. `exempt` says which paths no
 * ignore file hides: the files the runtime loads by itself, which a person keeps out of version control but the
 * runtime reads all the same.
 */
export class IgnoreFiles {
  private readonly scopes = new Map<string, { file: string; lines: IgnoreLine[] }[]>();
  private readonly entered = new Map<string, Promise<void>>();

  constructor(
    private readonly root: string,
    private readonly names: readonly string[],
    private readonly exempt: (path: string) => boolean = () => false,
  ) {}

  /** Whether any ignore file is honoured at all. */
  get active(): boolean {
    return this.names.length > 0;
  }

  /** Reads the ignore files of a folder (root-relative; '' is the root), once. */
  enter(folder: string): Promise<void> {
    if (!this.active) return Promise.resolve();
    let known = this.entered.get(folder);
    if (known === undefined) {
      known = (async () => {
        const found: { file: string; lines: IgnoreLine[] }[] = [];
        for (const name of this.names) {
          const file = join(this.root, folder, name);
          const info = await stat(file).catch(() => undefined);
          if (!info?.isFile() || info.size > MAX_BYTES) continue;
          const text = await readFile(file, 'utf8').catch(() => undefined);
          if (text !== undefined)
            found.push({ file: posix.join(folder, name), lines: parseIgnoreFile(text) });
        }
        if (found.length > 0) this.scopes.set(folder, found);
      })();
      this.entered.set(folder, known);
    }
    return known;
  }

  /**
   * The ignore file and line that hide an entry (a root-relative path, a folder or not), or undefined. The files
   * of its folder and of the folders above it must have been entered.
   */
  match(path: string, folder: boolean): { file: string; line: string } | undefined {
    if (!this.active || this.exempt(path)) return undefined;
    let found: { file: string; line: string } | undefined;
    const parts = path.split('/');
    // From the root down: a deeper file overrides a higher one.
    for (let depth = 0; depth < parts.length; depth++) {
      const scope = this.scopes.get(parts.slice(0, depth).join('/'));
      if (!scope) continue;
      const inside = parts.slice(depth).join('/');
      for (const { file, lines } of scope) {
        for (const line of lines) {
          if ((line.foldersOnly && !folder) || !line.test(inside)) continue;
          found = line.negated ? undefined : { file, line: line.text };
        }
      }
    }
    return found;
  }

  /** As `match`, for a path whose folders were not walked: the folders above it count, and their files are read. */
  async matchPath(path: string): Promise<{ file: string; line: string } | undefined> {
    const parts = path.split('/');
    for (let depth = 0; depth < parts.length; depth++) await this.enter(parts.slice(0, depth).join('/'));
    for (let depth = 1; depth < parts.length; depth++) {
      const hidden = this.match(parts.slice(0, depth).join('/'), true);
      if (hidden !== undefined) return hidden;
    }
    return this.match(path, false);
  }
}
