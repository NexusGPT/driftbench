import { posix } from 'node:path';
import { matchGlob } from './glob';
import type { PartType } from './part-type';

/**
 * Where a root-relative file lies among a type's parts, by syntax alone: the file a file glob matches, or the
 * entry file of a folder a folder glob matches. Entries inside a file (`glob#$.path`) are not files and are
 * matched by the part locator, which reads the file.
 */
export type FilePlace = {
  /** What the last `*` of the glob matched, when it has one. */
  match?: string;
  /** For the entry of a folder part: the folder, relative to the estate root. */
  folder?: string;
};

/** The path relative to a folder of the estate (`.` is the root), or undefined for a path outside it. */
export function pathWithin(folder: string, path: string): string | undefined {
  if (folder === '.' || folder === '') return path;
  return path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : undefined;
}

/** The place of a file among the parts a type locates from its own folder; undefined when it locates none there. */
export function locateFile(type: PartType, path: string): FilePlace | undefined {
  if (type.folder === undefined) return undefined;
  const relative = pathWithin(type.folder, path);
  if (relative === undefined) return undefined;
  for (const locator of type.locate) {
    if (locator.entries) continue;
    if (locator.glob.folder) {
      if (type.entry === undefined || posix.basename(relative) !== type.entry) continue;
      const parent = posix.dirname(relative);
      const found = parent === '.' ? undefined : matchGlob(locator.glob, parent);
      if (found) return { ...found, folder: rejoin(type.folder, parent) };
      continue;
    }
    const found = matchGlob(locator.glob, relative);
    if (found) return found;
  }
  return undefined;
}

/**
 * The folder part of a type that holds a file, and the file's path inside it: the nearest ancestor folder of the
 * file that one of the type's folder globs matches. The entry file of the folder is held too.
 */
export function folderHolding(
  type: PartType,
  path: string,
): { folder: string; inner: string; match?: string } | undefined {
  if (type.folder === undefined) return undefined;
  const relative = pathWithin(type.folder, path);
  if (relative === undefined) return undefined;
  const parts = relative.split('/');
  for (let depth = 1; depth < parts.length; depth++) {
    const folder = parts.slice(0, depth).join('/');
    for (const locator of type.locate) {
      if (!locator.glob.folder) continue;
      const found = matchGlob(locator.glob, folder);
      if (found)
        return { folder: rejoin(type.folder, folder), inner: parts.slice(depth).join('/'), ...found };
    }
  }
  return undefined;
}

/** The place of a path inside a folder part among a contained type's parts; undefined when it locates none. */
export function locateInside(type: PartType, inner: string): FilePlace | undefined {
  for (const locator of type.locate) {
    if (locator.entries || locator.glob.folder) continue;
    const found = matchGlob(locator.glob, inner);
    if (found) return found;
  }
  return undefined;
}

function rejoin(folder: string, path: string): string {
  return folder === '.' || folder === '' ? path : `${folder}/${path}`;
}
