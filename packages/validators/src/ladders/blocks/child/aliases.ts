import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { resolve } from 'node:path';

/**
 * The product's package names, resolved to their sources as the repository's path aliases say (tsconfig.base.json):
 * a child of the frame runs in a folder with no tsconfig of its own, so the loader the frame registers cannot read
 * them. The hook maps `@agent-nexus/driftbench-<name>` to its source file and leaves every other specifier alone.
 */

const HOOK = `
import { pathToFileURL } from 'node:url';
let table = [];
export function initialize(data) { table = data.table; }
export async function resolve(specifier, context, next) {
  for (const [pattern, target] of table) {
    const star = pattern.indexOf('*');
    if (star < 0) {
      if (specifier === pattern) return { url: pathToFileURL(target).href, shortCircuit: true };
      continue;
    }
    const head = pattern.slice(0, star);
    const tail = pattern.slice(star + 1);
    if (specifier.startsWith(head) && specifier.endsWith(tail) && specifier.length >= head.length + tail.length) {
      const middle = specifier.slice(head.length, specifier.length - tail.length);
      if (middle.includes('/')) continue;
      return { url: pathToFileURL(target.replace('*', middle)).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
`;

let registered = false;

/** The path aliases of the repository at `root`, longest pattern first, each with its absolute target. */
export function aliasTable(root: string): [string, string][] {
  const config = JSON.parse(readFileSync(resolve(root, 'tsconfig.base.json'), 'utf8')) as {
    compilerOptions: { paths: Record<string, string[]> };
  };
  return Object.entries(config.compilerOptions.paths)
    .map(([pattern, targets]) => [pattern, resolve(root, targets[0] as string)] as [string, string])
    .sort(([a], [b]) => b.length - a.length);
}

/** Registers the hook once in this process. */
export function registerAliases(root: string): void {
  if (registered) return;
  registered = true;
  register(`data:text/javascript,${encodeURIComponent(HOOK)}`, { data: { table: aliasTable(root) } });
}
