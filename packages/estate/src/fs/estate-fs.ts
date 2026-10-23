import type { Dirent } from 'node:fs';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { locateFile, type RuntimeProfile, variablePrefix } from '@agent-nexus/driftbench-core';
import { type IgnoreRule, ignoreRule } from '../scan/ignore';
import { IgnoreFiles } from './ignore-files';

/**
 * The one module every estate reader, scanner and mutant copier reads the disk through. It lists a folder in
 * exact case, keeps the symbolic link policy, stacks the ignore globs, expands the path variables of the
 * runtime profile, and stores paths relative to the estate root. A change of how the estate is read (case,
 * links, ignore files, a home folder) is made here once, never in each reader.
 */

export { lstat, readdir, readFile, realpath, stat };

/**
 * Name comparisons that fold case. The readers have always compared a few names regardless of case (a trash
 * folder, a guard named by an adapter column); this is the one switch for all of them. File listing and path
 * identity are exact case whatever it says.
 */
export const LEGACY_CASE_INSENSITIVE_NAMES = true;

/** A name as the readers compare it: folded when the legacy option is on, else as written. */
export function comparableName(name: string, foldCase: boolean = LEGACY_CASE_INSENSITIVE_NAMES): string {
  return foldCase ? name.toLowerCase() : name;
}

/** Two names the readers take as the same name. */
export function sameName(a: string, b: string, foldCase: boolean = LEGACY_CASE_INSENSITIVE_NAMES): boolean {
  return comparableName(a, foldCase) === comparableName(b, foldCase);
}

/** Exact-case order of names: by UTF-16 code unit, never by locale. */
export function byExactName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The entries of a folder in exact-case order, or an empty list when it cannot be read. */
export async function listFolder(folder: string): Promise<Dirent[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => [] as Dirent[]);
  return [...entries].sort((a, b) => byExactName(a.name, b.name));
}

/** Folder listings kept for one pass, by folder, so a name is checked against a listing once. */
export type Listings = Map<string, Promise<ReadonlySet<string> | undefined>>;

/**
 * Whether `file` (relative to `root`) is spelled, at every step, as the listing of its folder spells it. A name is
 * a file only if the listing holds it with exact case: on a disk that ignores case (a Mac, a Windows folder) `Notes.md`
 * opens `notes.md`, and the estate must not take that for a second file or a file the name reaches. The answer is
 * the same on every disk. A step `.` is skipped and `..` goes up one folder.
 */
export async function isSpelledOnDisk(
  root: string,
  file: string,
  listings: Listings = new Map(),
): Promise<boolean> {
  let folder = resolve(root);
  for (const part of file.split(/[\\/]+/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      folder = dirname(folder);
      continue;
    }
    let listing = listings.get(folder);
    if (listing === undefined) {
      listing = readdir(folder).then(
        (names) => new Set(names),
        () => undefined,
      );
      listings.set(folder, listing);
    }
    if (!(await listing)?.has(part)) return false;
    folder = join(folder, part);
  }
  return true;
}

/** The stat of a file the estate names, or undefined when it does not exist under exactly that spelling. */
export async function statSpelled(root: string, file: string, listings?: Listings) {
  return (await isSpelledOnDisk(root, file, listings))
    ? stat(join(root, file)).catch(() => undefined)
    : undefined;
}

/**
 * How the readers treat a symbolic link: the layout folder follows every link (a link out of the estate is
 * noted, then read); beside the layout, a link that leaves the estate is not followed.
 */
export type LinkPolicy = 'follow' | 'inside-only';

export const LAYOUT_LINKS: LinkPolicy = 'follow';
export const BESIDE_LAYOUT_LINKS: LinkPolicy = 'inside-only';

/** The real path of a file or folder, or undefined when it does not resolve. */
export async function realOf(path: string): Promise<string | undefined> {
  return realpath(path).catch(() => undefined);
}

/** True when a link at `path` under `root` points outside the root. */
export async function leavesRoot(root: string, path: string): Promise<boolean> {
  const link = await lstat(join(root, path)).catch(() => undefined);
  if (!link?.isSymbolicLink()) return false;
  const [real, base] = await Promise.all([realOf(join(root, path)), realOf(root)]);
  if (real === undefined || base === undefined) return false;
  const tail = relative(base, real);
  return tail === '..' || tail.startsWith(`..${sep}`) || isAbsolute(tail);
}

/**
 * Paths with one entry per real file: the first spelling of a file wins, a later spelling of the same real
 * file (a link, a second name) is dropped. A path that does not resolve is kept as it is.
 */
export async function dedupeByRealPath(root: string, paths: readonly string[]): Promise<string[]> {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const path of paths) {
    const real = await realOf(join(root, path));
    if (real !== undefined) {
      if (seen.has(real)) continue;
      seen.add(real);
    }
    kept.push(path);
  }
  return kept;
}

/** What hid a file: the glob, the ignore-file line, or the cache tag that kept it out of the estate. */
export type IgnoreHit = { label: string };

/**
 * The signature a folder's `CACHEDIR.TAG` starts with to say "this folder is a cache" (the Cache Directory
 * Tagging Specification). Tools that write caches (test runners, type checkers, linters, build tools) write the
 * tag; a folder that holds one is no part of any setup.
 */
export const CACHE_TAG_NAME = 'CACHEDIR.TAG';
const CACHE_TAG_SIGNATURE = 'Signature: 8a477f597d28d172789f06886806bc55';

/** True when a folder holds a valid cache tag. */
export async function isCacheFolder(folder: string): Promise<boolean> {
  const text = await readFile(join(folder, CACHE_TAG_NAME), 'utf8').catch(() => undefined);
  return text !== undefined && text.startsWith(CACHE_TAG_SIGNATURE);
}

/**
 * The files the runtime loads before every turn, by the part types of its profile: a person keeps them out of
 * version control (a local instruction, a local setting) and the runtime reads them all the same, so no ignore
 * file hides one.
 */
export function loadedAlways(profile: RuntimeProfile): (path: string) => boolean {
  const own = profile.types.types.filter(
    (type) => type.runtime === profile.name && type.loaded.when === 'always',
  );
  return (path) => {
    const clean = path.replace(/^\.?\/+/, '').replace(/\/+/g, '/');
    return own.some((type) => locateFile(type, clean) !== undefined);
  };
}

/**
 * The glob that keeps out a copy of the runtime's own layout folder found inside it. A folder named like the
 * layout folder, inside the layout folder, is another setup's (an agent's local memory, a template a skill
 * ships): its files are not this setup's parts.
 */
export function nestedLayoutGlob(profile: RuntimeProfile): string {
  return `/${profile.layout.root}/**/${posix.basename(profile.layout.root)}`;
}

/**
 * The ignore stack of an estate. It keeps a file out of the estate by, in order: the profile's globs, the layout's
 * own nested copy, the configured globs, the lines of the ignore files the profile honours (read in each folder
 * the reader enters), and a cache tag. A glob given twice is one rule at its first place. Every hit says what
 * hid the file, so the scan can count it and the lint can list it as skipped.
 */
export type IgnoreStack = {
  /** The globs, in order: the profile's, the layout's, the configured ones. */
  rules: IgnoreRule[];
  /** Reads the ignore files of a folder (root-relative; '' is the root). Call it before matching inside it. */
  enter(folder: string): Promise<void>;
  /** What hides a root-relative entry, from its folder's ignore files and the globs; the folder must have been entered. */
  match(path: string, folder?: boolean): IgnoreHit | undefined;
  /** As `match`, for a path whose folders were not walked: every folder above it counts and is entered. */
  matchPath(path: string): Promise<IgnoreHit | undefined>;
  /** The cache tag of a root-relative folder, when it holds a valid one. */
  cache(folder: string): Promise<IgnoreHit | undefined>;
  /** The same globs over another tree (a folder that is not the estate's): no ignore file is read there. */
  rebased(folder: string): Promise<IgnoreStack>;
};

export async function ignoreStack(
  root: string,
  profile: RuntimeProfile,
  configured: readonly string[],
  options: { ignoreFiles?: boolean } = {},
): Promise<IgnoreStack> {
  // An ignore file is a rule for the reader, not a part of the estate: it is never read as content.
  const rules = [
    ...new Set([...profile.ignore, ...profile.ignoreFiles, nestedLayoutGlob(profile), ...configured]),
  ].map(ignoreRule);
  const files = new IgnoreFiles(
    root,
    options.ignoreFiles === false ? [] : profile.ignoreFiles,
    loadedAlways(profile),
  );
  const globHit = (path: string): IgnoreHit | undefined => {
    const rule = rules.find((candidate) => candidate.test(path));
    return rule ? { label: rule.pattern } : undefined;
  };
  const fileHit = (hit: { file: string; line: string } | undefined): IgnoreHit | undefined =>
    hit ? { label: `${hit.file}: ${hit.line}` } : undefined;
  return {
    rules,
    enter: (folder) => files.enter(folder),
    match: (path, folder = false) => globHit(path) ?? fileHit(files.match(path, folder)),
    matchPath: async (path) => {
      const hit = globHit(path) ?? fileHit(await files.matchPath(path));
      if (hit !== undefined) return hit;
      // A file inside a folder that tags itself as a cache is no part of the estate either.
      const parts = path.split('/');
      for (let depth = 1; depth < parts.length; depth++)
        if (await isCacheFolder(join(root, ...parts.slice(0, depth)))) return { label: CACHE_TAG_NAME };
      return undefined;
    },
    cache: async (folder) =>
      (await isCacheFolder(join(root, folder))) ? { label: CACHE_TAG_NAME } : undefined,
    rebased: (folder) => ignoreStack(folder, profile, configured, { ignoreFiles: false }),
  };
}

/** The folders a path variable stands for, when a scan maps them: `--home` and the estate root. */
export type VariableFolders = { root: string; home?: string };

/**
 * A path written behind one of the profile's variables, expanded: the project and plugin variables to the
 * estate root (root-relative, so the result is relative), the home variable and `~/` to the home folder (the
 * `--home` folder when one is given, else the user's own). A path behind no variable comes back as written.
 */
export function expandVariables(path: string, profile: RuntimeProfile, folders: VariableFolders): string {
  const project = variablePrefix([...profile.pathVariables.project, ...profile.pathVariables.plugin]);
  if (project.test(path)) return path.replace(project, '');
  const home = folders.home ?? homedir();
  const homeVariable = variablePrefix(profile.pathVariables.home);
  if (homeVariable.test(path)) return join(home, path.replace(homeVariable, ''));
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return path;
}

/** A path stored in a map: relative to the estate root, with `/`, or undefined for a path outside the root. */
export function rootRelative(root: string, path: string): string | undefined {
  const tail = relative(root, isAbsolute(path) ? path : join(root, path));
  if (tail === '..' || tail.startsWith(`..${sep}`) || isAbsolute(tail)) return undefined;
  return tail === '' ? '.' : posix.normalize(tail.split(sep).join('/'));
}
