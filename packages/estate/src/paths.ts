import { lstat, readdir, readlink, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export class EstatePathError extends Error {}

/** Component-aware containment, including missing parents and dangling links. */
async function resolvedPath(path: string, links = 0): Promise<string> {
  if (links > 40) throw new EstatePathError(`too many symbolic links resolving ${path}`);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return resolvedPath(resolve(dirname(path), await readlink(path)), links + 1);
    return await realpath(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    const parent = dirname(path);
    if (parent === path) throw cause;
    return resolve(await resolvedPath(parent, links), basename(path));
  }
}

function within(root: string, path: string): boolean {
  const tail = relative(root, path);
  return tail !== '..' && !tail.startsWith(`..${sep}`) && !isAbsolute(tail);
}

/** Validate before any read or write; return the canonical path so links are not followed again. */
export async function estatePath(root: string, file: string): Promise<string> {
  const base = resolve(root);
  const path = resolve(base, file);
  if (isAbsolute(file) || !within(base, path))
    throw new EstatePathError(`${file} is absolute or outside the estate root ${base}; refused`);
  const canonicalRoot = await resolvedPath(base);
  const canonical = await resolvedPath(path);
  if (!within(canonicalRoot, canonical))
    throw new EstatePathError(
      `${file} resolves to ${canonical}, outside the estate root ${canonicalRoot}; refused`,
    );
  return canonical;
}

/**
 * A file read from the estate and copied elsewhere: its name must stay inside the root as written (no
 * absolute path, no `..` out of it), but a link in the layout is followed, as the reader follows it.
 */
export function estateSource(root: string, file: string): string {
  const base = resolve(root);
  const path = resolve(base, file);
  if (isAbsolute(file) || !within(base, path))
    throw new EstatePathError(`${file} is absolute or outside the estate root ${base}; refused`);
  return path;
}

/** Folder listings, by folder, kept for one pass so a name is checked against a listing once. */
export type Listings = Map<string, Promise<ReadonlySet<string> | undefined>>;

/**
 * Whether `file` is spelled, at every step, as the folder listing of the disk spells it. The disk may be case
 * insensitive (a Mac, a Windows folder) or not (Linux): a name is looked up against the listing, with exact
 * case, so one file has one path on every disk and `VENDORED.md` never lands on `vendored.md`.
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
      const at = folder;
      listing = readdir(at).then(
        (names) => new Set(names),
        () => undefined,
      );
      listings.set(folder, listing);
    }
    if (!(await listing)?.has(part)) return false;
    folder = resolve(folder, part);
  }
  return true;
}
