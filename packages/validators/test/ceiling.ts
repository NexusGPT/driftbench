import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * A ceiling that may only go down. The count of failures that are not `ItemFailure` is compared with the value
 * committed in this branch, and that value is compared with the one on the base branch, so a PR cannot raise the
 * ceiling in the same diff that raises the count (review of #1385).
 */
export function ceilingVerdict(count: number, head: number, base: number | undefined): string | undefined {
  if (base !== undefined && head > base)
    return `the committed ceiling ${head} is above the base's ${base}; a ceiling only goes down`;
  if (count > head) return `${count} unstructured failures, above the committed ceiling ${head}`;
  return undefined;
}

/** The ceiling of `key` in the file at `path`, in the working tree and on the base ref (undefined when it has none). */
export function readCeilings(
  path: string,
  key: string,
  baseRef = process.env.LEAK_BASE_REF ?? 'origin/release/next',
): { head: number; base: number | undefined } {
  const head = (JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>)[key];
  if (typeof head !== 'number') throw new Error(`${path} has no ceiling for ${key}`);
  let base: number | undefined;
  try {
    const text = execFileSync('git', ['show', `${baseRef}:${path.replace(/^.*?(validators\/)/, '$1')}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const value = (JSON.parse(text) as Record<string, number>)[key];
    base = typeof value === 'number' ? value : undefined;
  } catch {
    base = undefined;
  }
  return { head, base };
}
