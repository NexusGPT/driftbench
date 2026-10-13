import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const baseline = 'd702d90b7fcbf846295190b8648c452ba9c48470';
const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, 'packages/judges/src'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter((p) => p !== 'packages/judges/src/index.ts');
const checks = [];
for (const path of paths) {
  const original = execFileSync('git', ['show', `${baseline}:${path}`]);
  const current = await readFile(path);
  checks.push({
    path,
    unchanged: original.equals(current),
    sha256: createHash('sha256').update(current).digest('hex'),
  });
}
const result = {
  baseline,
  defaultSourceFiles: checks.length,
  allByteIdentical: checks.every((x) => x.unchanged),
  exception: 'index.ts adds named exports only; no existing export is removed or changed',
  checks,
};
await writeFile(
  'comparisons/reader-first/results/default-proof.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify({ ...result, checks: undefined }, null, 2));
if (!result.allByteIdentical) process.exitCode = 1;
