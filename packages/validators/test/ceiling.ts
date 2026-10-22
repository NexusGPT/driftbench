import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * A ceiling that may only go down. The count of failures that are not `ItemFailure` is compared with the value
 * committed in this branch, and that value is compared with the one on the base branch, so a PR cannot raise the
 * ceiling in the same diff that raises the count (review of #1385).
 */
export function ceilingVerdict(count: number, head: number, base: number | undefined): string | undefined {
  if (base !== undefined && head > base) return `the committed ceiling ${head} is above the base's ${base}; a ceiling only goes down`;
  if (count > head) return `${count} unstructured failures, above the committed ceiling ${head}`;
  return undefined;
}

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...(cwd ? { cwd } : {}) });
}

/**
 * The ceiling of `key` in the file at `path` (a path relative to the repository root), in the working tree and on the
 * base ref. It fails closed: a base ref that cannot be read is an error naming the ref, never "no limit". Only a
 * base that exists and does not have the file, or the key, gives `base: undefined` (the first PR of a ceiling).
 */
export function readCeilings(
  root: string,
  path: string,
  key: string,
  baseRef = process.env.LEAK_BASE_REF ?? 'origin/release/next',
): { head: number; base: number | undefined } {
  const head = (JSON.parse(readFileSync(`${root}/${path}`, 'utf8')) as Record<string, number>)[key];
  if (typeof head !== 'number') throw new Error(`${path} has no ceiling for ${key}`);
  try {
    git(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], root);
  } catch {
    throw new Error(
      `the base ref ${baseRef} cannot be read, so the ceiling cannot be compared with it (fetch it, or set LEAK_BASE_REF)`,
    );
  }
  let text: string | undefined;
  try {
    git(['cat-file', '-e', `${baseRef}:${path}`], root);
    text = git(['show', `${baseRef}:${path}`], root);
  } catch {
    text = undefined; // the base is readable and does not have the file
  }
  if (text === undefined) return { head, base: undefined };
  let value: unknown;
  try {
    value = (JSON.parse(text) as Record<string, unknown>)[key];
  } catch {
    throw new Error(`${path} on ${baseRef} is not valid JSON, so its ceiling cannot be read`);
  }
  return { head, base: typeof value === 'number' ? value : undefined };
}
