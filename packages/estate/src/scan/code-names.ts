import { posix } from 'node:path';
import type { RawEstate } from './reader';

/**
 * Files that code and registries name. A script, a registry or a settings file that holds a quoted file name
 * is a reference as much as a sentence is: the runtime opens, writes or loads that file. Prose is not read
 * here (the prose scanner owns it); only files that are not prose are.
 */
const PROSE = /\.(?:md|markdown|txt)$/i;
const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n]){2,200}?)\1/g;
const MAX_CODE_BYTES = 1_000_000;

export type CodeNames = {
  /** Code file to the existing estate files it names. */
  links: Map<string, string[]>;
  /** Every file-like literal the code holds, as normalized paths without leading `./`. */
  literals: Set<string>;
};

const BUILT = new WeakMap<RawEstate, CodeNames>();

/** The file-like literals of a code text: no spaces, a separator or an extension, not a URL or an option. */
export function fileLiterals(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(LITERAL)) {
    const value = (match[2] ?? '')
      .replace(/\\\//g, '/')
      .replace(/^\$\{?(?:CLAUDE_PROJECT_DIR|PWD|HOME)\}?\//, '')
      .replace(/^\.\//, '');
    if (value.length < 3 || /[\s<>*?{}$|;&=,()[\]]/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value))
      continue;
    if (value.startsWith('-') || value.endsWith('/')) continue;
    if (!/[/]/.test(value) && !/\.[A-Za-z0-9]+$/.test(value) && !/^\./.test(value)) continue;
    found.add(value);
  }
  return [...found];
}

/** The folder and every folder above it, nearest first. */
function ancestors(folder: string): string[] {
  const found = [folder];
  for (let current = folder; current !== '.' && current !== '/'; ) {
    current = posix.dirname(current);
    found.push(current);
  }
  return found;
}

export function codeNames(raw: RawEstate): CodeNames {
  const cached = BUILT.get(raw);
  if (cached) return cached;
  const paths = new Set(raw.files.map((file) => file.path));
  const links = new Map<string, string[]>();
  const literals = new Set<string>();
  for (const file of raw.files) {
    if (PROSE.test(file.path) || file.text.length > MAX_CODE_BYTES) continue;
    const folder = posix.dirname(file.path);
    const targets = new Set<string>();
    for (const literal of fileLiterals(file.text)) {
      literals.add(literal);
      // A script finds a file from its own folder or from one of the folders above it, never by a loose ending.
      const hit = ancestors(folder)
        .map((base) => posix.normalize(posix.join(base, literal)))
        .find((candidate) => paths.has(candidate) && candidate !== file.path);
      if (hit) targets.add(hit);
    }
    if (targets.size > 0) links.set(file.path, [...targets]);
  }
  const built = { links, literals };
  BUILT.set(raw, built);
  return built;
}

/**
 * Whether code or a registry names a path that does not exist as a file: the runtime creates it (a marker, a
 * state file, a log), so a prose line that names it describes a runtime product, not a broken dependency.
 */
export function runtimeProduct(raw: RawEstate, path: string): boolean {
  const clean = posix.normalize(path.replace(/^\.\//, ''));
  const tail = clean.split('/').filter((segment) => segment && segment !== '..');
  if (tail.length === 0) return false;
  const { literals } = codeNames(raw);
  // A lone file name matches only as a whole path: `README.md` in a script is not every README.
  if (tail.length === 1) return literals.has(tail[0] as string);
  for (let start = 0; start < tail.length - 1; start++) {
    if (literals.has(tail.slice(start).join('/'))) return true;
  }
  // Code may write more of the path than the sentence does.
  const written = tail.join('/');
  for (const literal of literals) if (literal.endsWith(`/${written}`)) return true;
  return false;
}
