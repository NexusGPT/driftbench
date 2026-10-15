import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

/**
 * Every reader of a block's pass goes through `blockStatus`, `isScored`, `runOutcome` or `blocksOutcome`
 * (core runner/verdicts.ts), never through `block.pass`: a block not run or blocked has `pass` false and is no
 * failure. This scans the source of every package (the validators excepted) for a direct read.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const READ = /\b(?:block|b|blk|observed|before|now|injected|sent|skipped)\??\.pass\b/;
/** A copy of the field into a record or an event is data, not a verdict. */
const COPY = /^\s*pass: \w+\.pass,\s*$/;
/** Where a direct read is the rule itself, or a stored copy of the field. */
const ALLOWED: Record<string, string> = {
  'packages/core/src/runner/verdicts.ts': 'the helpers every reader calls',
  'packages/core/src/runner/run.ts': "the block_end event carries the block's pass field beside its status",
  'packages/store/src/store.ts': 'the stored pass column, beside the stored status',
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

it('no package reads block.pass outside the verdict helpers', () => {
  const packages = join(ROOT, 'packages');
  const found = readdirSync(packages)
    .filter(
      (name) => name !== 'validators' && statSync(join(packages, name, 'src'), { throwIfNoEntry: false }),
    )
    .flatMap((name) => sources(join(packages, name, 'src')))
    .flatMap((path) => {
      const file = relative(ROOT, path);
      if (ALLOWED[file]) return [];
      return readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          READ.test(line) && !COPY.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [],
        );
    });
  expect(found).toEqual([]);
});
