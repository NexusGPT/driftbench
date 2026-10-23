import { readFile, stat } from 'node:fs/promises';
import { posix } from 'node:path';

/** A line of a `.gitignore`: its glob, whether it brings files back (`!`), and whether it names folders only. */
export type GitRule = {
  pattern: string;
  negated: boolean;
  /** A trailing slash: the rule names folders only. */
  folderOnly: boolean;
  /** A slash at the start or in the middle: the glob is relative to the folder of the `.gitignore`. */
  anchored: boolean;
  test(path: string): boolean;
};

const MAX_BYTES = 1024 * 1024;

/** The local files the runtime loads whatever a `.gitignore` says: they are local by design and git-ignored by habit. */
function isLocalFile(path: string): boolean {
  return path === '.claude/settings.local.json' || posix.basename(path) === 'CLAUDE.local.md';
}

/** A glob of a `.gitignore` as a regular expression on one path from the folder of the file. */
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

/** The rules of one `.gitignore`, in file order. Blank lines and comments carry none. */
export function parseGitignore(text: string): GitRule[] {
  const rules: GitRule[] = [];
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    // Trailing spaces go unless escaped.
    let line = raw.replace(/(?<!\\)\s+$/, '');
    if (line === '' || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    if (negated) line = line.slice(1);
    if (line === '') continue;
    const folderOnly = line.endsWith('/');
    const glob = line.replace(/\/+$/, '');
    if (glob === '') continue;
    const anchored = glob.includes('/');
    const body = globSource(glob.replace(/^\/+/, ''));
    // An unanchored glob names one entry at any depth; an anchored one the path from the `.gitignore`.
    const regex = new RegExp(`^${body}$`);
    rules.push({
      pattern: raw.trim(),
      negated,
      folderOnly,
      anchored,
      test: (path) => regex.test(anchored ? path : posix.basename(path)),
    });
  }
  return rules;
}

/**
 * The `.gitignore` files of an estate. Each applies to the folder it sits in and below it; a later line wins
 * over an earlier one and a deeper file over a higher one; a file inside an ignored folder is ignored whatever
 * a later line says. A file is looked up by what the match was: the label names the `.gitignore` and the line,
 * so the scan can say what hid a file. The `.gitignore` files above the estate root are not read.
 */
export class GitIgnore {
  private readonly scopes = new Map<string, GitRule[]>();
  private readonly loading = new Map<string, Promise<void>>();

  constructor(private readonly root: string) {}

  /** Reads the `.gitignore` of a folder (relative to the root; '' is the root), once. */
  enter(folder: string): Promise<void> {
    let known = this.loading.get(folder);
    if (known === undefined) {
      known = (async () => {
        const file = posix.join(this.root, folder, '.gitignore');
        const info = await stat(file).catch(() => undefined);
        if (!info?.isFile() || info.size > MAX_BYTES) return;
        const text = await readFile(file, 'utf8').catch(() => undefined);
        if (text !== undefined) this.scopes.set(folder, parseGitignore(text));
      })();
      this.loading.set(folder, known);
    }
    return known;
  }

  /**
   * The label of the line that hides an entry (a path from the root, a folder or not), or undefined. The
   * `.gitignore` files of its folder and the folders above it must have been entered.
   */
  match(path: string, folder: boolean): string | undefined {
    if (isLocalFile(path)) return undefined;
    let found: string | undefined;
    const parts = path.split('/');
    // Scopes from the root down: a deeper file overrides a higher one.
    for (let depth = 0; depth < parts.length; depth++) {
      const base = parts.slice(0, depth).join('/');
      const rules = this.scopes.get(base);
      if (!rules) continue;
      const inside = parts.slice(depth).join('/');
      for (const rule of rules) {
        if (rule.folderOnly && !folder) continue;
        if (!rule.test(inside)) continue;
        found = rule.negated ? undefined : `${base === '' ? '' : `${base}/`}.gitignore: ${rule.pattern}`;
      }
    }
    return found;
  }

  /** As `match`, for a path whose folders have not been walked: its ancestors count, and every `.gitignore` on the way is read. */
  async matchPath(path: string): Promise<string | undefined> {
    const parts = path.split('/');
    for (let depth = 0; depth < parts.length; depth++) await this.enter(parts.slice(0, depth).join('/'));
    for (let depth = 1; depth < parts.length; depth++) {
      const hidden = this.match(parts.slice(0, depth).join('/'), true);
      if (hidden !== undefined) return hidden;
    }
    return this.match(path, false);
  }
}
