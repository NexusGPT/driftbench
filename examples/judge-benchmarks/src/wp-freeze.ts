import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (s: string) => {
  const i = process.argv.indexOf(`--${s}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const input = arg('dev-report'),
  variant = arg('variant'),
  validationPath = arg('validation-report');
if (!input || !variant || !validationPath)
  throw new Error('--dev-report, --variant and --validation-report required');
const validation = JSON.parse(await readFile(validationPath, 'utf8'));
if (
  validation.split !== 'dev' ||
  validation.selection.variant !== variant ||
  validation.selection.path !== input
)
  throw new Error('Freeze must select the design chosen on the 80 DEV pairs outside the tuning pilot');
const report = JSON.parse(await readFile(input, 'utf8'));
if (
  report.split !== 'dev' ||
  report.pilot ||
  report.stopped ||
  report.items !== 90 ||
  report.results.length !== 90 ||
  report.summary.missing
)
  throw new Error('Freeze requires a complete 90-pair DEV result');
const frozenAt = new Date().toISOString();
if (Date.parse(frozenAt) > Date.parse('2026-10-13T02:30:00Z'))
  throw new Error('04:30 local freeze deadline passed');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const namespaces = [
  'examples/judge-benchmarks/src',
  'packages/judges/src',
  'packages/core/src',
  'packages/stats/src',
];
const dirty = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', ...namespaces], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const untracked = execFileSync(
  'git',
  ['ls-files', '--others', '--exclude-standard', '--', 'examples/judge-benchmarks/src'],
  { cwd: root, encoding: 'utf8' },
).trim();
if (dirty || untracked) throw new Error('Commit all judging source before freezing');
const designSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const files = execFileSync('git', ['ls-files', '--', ...namespaces], { cwd: root, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((p) => p.endsWith('.ts') || p.endsWith('/SOURCE.json'));
const sourceHashes: Record<string, string> = {};
for (const p of files)
  sourceHashes[p] = createHash('sha256')
    .update(await readFile(resolve(root, p)))
    .digest('hex');
const shared = JSON.parse(
  await readFile(new URL('./shared-judge-arch/SOURCE.json', import.meta.url), 'utf8'),
);
const manifest = {
  designSha,
  variant,
  frozenAt,
  devReport: input,
  validationReport: validationPath,
  validation80: validation.selection.validationAccuracy,
  officialDev: report.summary,
  devPerOrder: report.perOrder,
  costPer100: report.costPer100,
  contractSha: shared.commit,
  contractReviewStatus: shared.reviewStatus,
  sourceHashes,
  testAuthorized: true,
  testDeadlineUTC: '2026-10-13T04:30:00Z',
  noJudgingChangesAfterFreeze: true,
};
await writeFile(
  new URL('../census/wp-freeze.json', import.meta.url),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(JSON.stringify({ ...manifest, sourceHashes: undefined }, null, 2));
