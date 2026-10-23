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

/** A glob as the source of a regular expression on one path from the folder of the file. */
function globSource(glob: string): string {
  let source = '';
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index] ?? '';
    if (glob.startsWith('**/', index) && (index === 0 || glob[index - 1] === '/')) {
      source += '(?:[^/]+/)*';
      index += 2;
    } else if (glob.startsWith('/**', index) && index + 3 === glob.length) {
      source += '/.+';
      index += 2;
    } else if (char === '*') {
      while (glob[index + 1] === '*') index++;
      source += '[^/]*';
    } else if (char === '?') source += '[^/]';
    else if (char === '[') {
      const close = glob.indexOf(']', index + 2);
      if (close < 0) source += '\\[';
      else {
        const body = glob
          .slice(index + 1, close)
          .replace(/^[!^]/, '^')
          .replace(/\\/g, '\\\\');
        source += `[${body}]`;
        index = close;
      }
    } else if (char === '\\' && index + 1 < glob.length) {
      index++;
      source += (glob[index] ?? '').replace(/[.+^${}()|[\]\\*?]/g, '\\$&');
    } else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return source;
}

/** The lines of one ignore file, in file order. */
export function parseIgnoreFile(text: string): IgnoreLine[] {
  const lines: IgnoreLine[] = [];
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\)\s+$/, '');
    if (line === '' || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    if (negated) line = line.slice(1);
    const foldersOnly = line.endsWith('/');
    const glob = line.replace(/\/+$/, '');
    if (glob === '') continue;
    const anchored = glob.includes('/');
    const regex = new RegExp(`^${globSource(glob.replace(/^\/+/, ''))}$`);
    lines.push({
      text: raw.trim(),
      negated,
      foldersOnly,
      anchored,
      test: (path) => regex.test(anchored ? path : posix.basename(path)),
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
