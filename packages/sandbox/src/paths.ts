import { lstat, mkdir, realpath } from 'node:fs/promises';
import { join, posix, sep } from 'node:path';
import { SandboxPathError } from './limits';

/**
 * Path rules of a workspace. Every path a caller hands a sandbox is relative to the workspace root and
 * may not leave it, by `..`, by an absolute path or through a symbolic link the agent planted.
 */

/** Normalizes a workspace path to a relative POSIX path, or throws when it leaves the workspace. */
export function relativeInside(path: string): string {
  if (path.length === 0) throw new SandboxPathError('a workspace path is empty');
  if (path.includes('\0'))
    throw new SandboxPathError(`the workspace path ${JSON.stringify(path)} holds a NUL byte`);
  if (posix.isAbsolute(path)) {
    throw new SandboxPathError(`the workspace path ${path} is absolute; give it relative to the workspace`);
  }
  const normal = posix.normalize(path).replace(/\/+$/, '');
  if (normal === '..' || normal.startsWith('../')) {
    throw new SandboxPathError(`the workspace path ${path} leaves the workspace`);
  }
  return normal;
}

/** True when `candidate` is `root` or a path below it. Both must be real paths. */
export function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/**
 * Resolves an existing workspace path to its real path, following symbolic links, and throws when the
 * target lies outside the workspace.
 */
export async function resolveExisting(root: string, path: string): Promise<string> {
  const rel = relativeInside(path);
  const real = await realpath(join(root, rel));
  if (!isInside(root, real)) {
    throw new SandboxPathError(`the workspace path ${path} resolves outside the workspace`);
  }
  return real;
}

/**
 * Creates the folders of a relative folder path inside the workspace, one level at a time, and refuses
 * a level that is a symbolic link, so a write can never follow a link out of the workspace.
 */
export async function makeFoldersInside(root: string, relFolder: string): Promise<string> {
  let current = root;
  if (relFolder === '.' || relFolder === '') return current;
  for (const part of relFolder.split('/')) {
    current = join(current, part);
    const stat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (stat === undefined) {
      await mkdir(current);
    } else if (stat.isSymbolicLink()) {
      throw new SandboxPathError(`the workspace folder ${relFolder} passes through a symbolic link`);
    } else if (!stat.isDirectory()) {
      throw new SandboxPathError(`the workspace path ${relFolder} is a file, not a folder`);
    }
  }
  return current;
}
