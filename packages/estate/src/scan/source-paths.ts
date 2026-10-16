import { homedir } from 'node:os';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import type { EstateFile } from './reader';

/** Home syntax always names the actual home, independently of the configured skill catalogue. */
export function physicalName(path: string): string | undefined {
  if (path.startsWith('~/')) return normalize(join(homedir(), path.slice(2)));
  return isAbsolute(path) ? normalize(path) : undefined;
}

/** Resolve known overlay sources before a logical project path can bind the same spelling. */
export function sourceFileOf(
  path: string,
  from: string,
  files: ReadonlyMap<string, EstateFile>,
): EstateFile | undefined {
  const source = files.get(from)?.sourcePath;
  const physical = physicalName(path) ?? (source ? resolve(dirname(source), path) : undefined);
  if (!physical) return undefined;
  for (const file of files.values()) {
    if (
      [...(file.sourcePath ? [file.sourcePath] : []), ...(file.sourcePaths ?? [])].some(
        (value) => normalize(value) === physical,
      )
    )
      return file;
  }
  return undefined;
}

/** Logical copied paths and physical source spellings remain aliases of one selected file. */
export function readPaths(file: EstateFile | undefined, logical: string): string[] {
  const paths = [logical];
  for (const source of [...(file?.sourcePath ? [file.sourcePath] : []), ...(file?.sourcePaths ?? [])]) {
    const physical = normalize(source);
    paths.push(physical);
    const home = normalize(homedir());
    if (physical.startsWith(`${home}/`)) paths.push(`~/${physical.slice(home.length + 1)}`);
  }
  return [...new Set(paths)];
}

export function readAssertion(paths: readonly string[]): { contains: string } | { regex: string } {
  const first = paths[0] ?? '';
  if (paths.length === 1) return { contains: first };
  const escapePattern = (path: string) => path.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
  return {
    regex: paths.map((path) => `${(physicalName(path) ? '^' : '(?:^|/)') + escapePattern(path)}$`).join('|'),
  };
}
