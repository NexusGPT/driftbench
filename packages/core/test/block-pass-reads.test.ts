import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

/**
 * One reader of a block's verdict. In TypeScript every reader of a block's `pass` or `status` goes through
 * `blockStatus`, `isScored`, `skipReason`, `runOutcome` or `blocksOutcome` (core runner/verdicts.ts); in the
 * Python client every reader of a block's `passed` or `status` or a cell's state goes through `verdict_of`
 * (results.py). A block not run or blocked has `pass` false and is no failure: a direct read is how it got read as
 * one. This scans the source of every package (the validators excepted) and of the Python client.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TS_READ = /\b(?:block|b|blk|observed|before|now|injected|sent|skipped)\??\.(?:pass|status)\b/;
/** A copy of the field into a record, an event or JSON is data, not a verdict. */
const TS_COPY = [
  /^\s*pass: \w+\.pass,\s*$/,
  /^\s*\.\.\.\(\w+\.status === undefined \? \{\} : \{ status: \w+\.status \}\),\s*$/,
  // Other records with a status of their own: a generated block's review state, a gate stage's verdict.
  /\.status [!=]== 'accepted'/,
  /stages\.\w+\.status/,
];
const PY_READ =
  /\b(?:block|cell|b|c)\.(?:passed|scored|status)\b|\b(?:block|cell|b|c)\.state\s*(?:==|!=|in\b|not in\b)/;
/** Where a direct read is the rule itself, or a stored copy of the field. */
const ALLOWED: Record<string, string> = {
  'packages/core/src/runner/verdicts.ts': 'the helpers every reader calls',
  'packages/core/src/runner/run.ts': "the block_end event carries the block's pass field beside its status",
  'packages/store/src/store.ts': 'the stored pass column, beside the stored status',
  'python/driftbench/src/driftbench/results.py': 'verdict_of, and the dataclasses that hold the fields',
};

function sources(dir: string, extension: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path, extension);
    return path.endsWith(extension) ? [path] : [];
  });
}

function directReads(paths: readonly string[], read: RegExp, copies: readonly RegExp[]): string[] {
  return paths.flatMap((path) => {
    const file = relative(ROOT, path);
    if (ALLOWED[file]) return [];
    return readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        read.test(line) && !copies.some((copy) => copy.test(line))
          ? [`${file}:${index + 1}: ${line.trim()}`]
          : [],
      );
  });
}

it('no package reads a block pass or status outside the verdict helpers', () => {
  const packages = join(ROOT, 'packages');
  const paths = readdirSync(packages)
    .filter(
      (name) => name !== 'validators' && statSync(join(packages, name, 'src'), { throwIfNoEntry: false }),
    )
    .flatMap((name) => sources(join(packages, name, 'src'), '.ts'));
  expect(directReads(paths, TS_READ, TS_COPY)).toEqual([]);
});

it('the Python client reads a block or a cell verdict only through verdict_of', () => {
  const paths = sources(join(ROOT, 'python/driftbench/src'), '.py');
  expect(paths.length).toBeGreaterThan(0);
  expect(directReads(paths, PY_READ, [])).toEqual([]);
});
