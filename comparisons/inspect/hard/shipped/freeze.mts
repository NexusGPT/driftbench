import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPrompt } from '../../../../packages/judges/src/prompt';
import { generate, type Row, rows } from '../generate.mts';
import { promptFor, requestSha256 } from '../harness';
import { recordingLines } from '../recordings';
import { requestFor } from './request';

// Writes the fresh held-out sets and the freeze manifest. Run once, before any held-out call:
//   node --import tsx comparisons/inspect/hard/shipped/freeze.mts
// Seed rule, fixed before any outcome exists: per row group, the first seed at or after the start value whose
// 60 requests are unique on each side and match no request recorded earlier, on either side.
const here = fileURLToPath(new URL('./', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const out = `${here}heldout/`;
if (existsSync(`${out}freeze.json`)) throw new Error('The held-out set is already frozen');
mkdirSync(out, { recursive: true });
const starts: Record<Row, number> = { qa: 71001, fact: 71001, panel: 72001, borderline: 73001 };
const seen = new Set<string>();
for (const line of recordingLines(new URL('../', import.meta.url))) {
  const record = JSON.parse(line);
  seen.add(record.request_sha256 ?? record.key);
}
for (const line of recordingLines(new URL('./', import.meta.url))) seen.add(JSON.parse(line).request_sha256);

const digests = (row: Row, seed: number) => {
  const cases = generate(row, { seed, count: 60 });
  return {
    cases,
    ours: cases.map((c) => requestSha256(buildPrompt(requestFor(c, row, 'audit')), 0)),
    theirs: cases.map((c) => requestSha256(promptFor(c, row, 'theirs'), 0)),
  };
};
const fresh = (row: Row, seed: number) => {
  const { ours, theirs } = digests(row, seed);
  return (
    new Set(ours).size === 60 && new Set(theirs).size === 60 && ![...ours, ...theirs].some((d) => seen.has(d))
  );
};
const seeds = {} as Record<Row, number>;
for (const group of [['qa', 'fact'], ['panel'], ['borderline']] as Row[][]) {
  let seed = starts[group[0] as Row];
  while (!group.every((row) => fresh(row, seed))) seed++;
  for (const row of group) seeds[row] = seed;
}
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sha256: Record<string, string> = {};
for (const row of rows) {
  const { cases } = digests(row, seeds[row]);
  if (cases.filter((c) => c.label === 'pass').length !== 30) throw new Error(`${row} is not balanced`);
  writeFileSync(`${out}${row}.json`, `${JSON.stringify(cases, null, 2)}\n`);
  sha256[`comparisons/inspect/hard/shipped/heldout/${row}.json`] = sha(`${out}${row}.json`);
}
// Everything that decides a verdict on either side: the judge package source, both request builders, the
// verbatim Inspect templates and parser, the generator and this runner.
const judgeSource = readdirSync(`${repo}packages/judges/src`, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => `${entry.parentPath.slice(repo.length)}/${entry.name}`)
  .sort();
for (const path of [
  ...judgeSource,
  ...[
    'generate.mts',
    'harness.ts',
    'recordings.ts',
    'qa-template.txt',
    'fact-template.txt',
    'instructions.txt',
  ].map((name) => `comparisons/inspect/hard/${name}`),
  ...['run.mts', 'request.ts', 'freeze.mts'].map((name) => `comparisons/inspect/hard/shipped/${name}`),
])
  sha256[path] = sha(`${repo}${path}`);
const dirty = execFileSync(
  'git',
  ['status', '--porcelain', '--', 'packages/judges', 'comparisons/inspect/hard'],
  {
    cwd: repo,
    encoding: 'utf8',
  },
)
  .split('\n')
  .filter((line) => line && !line.includes('shipped/heldout/') && !line.includes('shipped/calls'));
if (dirty.length) throw new Error(`Commit the judge and the harness before freezing:\n${dirty.join('\n')}`);
writeFileSync(
  `${out}freeze.json`,
  `${JSON.stringify(
    {
      frozenAt: new Date().toISOString(),
      judgeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
      seeds,
      seedSelection:
        'Per row group, the first seed at or after its start value (71001 QA and fact, 72001 panel, 73001 borderline) with 60 unique requests per side and no match to any earlier recorded request. No model outcome is used.',
      casesPerRow: 60,
      pass: 30,
      fail: 30,
      labelsFixedBeforeRun: true,
      ours: 'assessment answer-audit of packages/judges at judgeCommit, through the request of shipped/request.ts',
      theirs: 'verbatim inspect_ai model_graded_qa and model_graded_fact templates pinned at a1dbea8',
      model: 'haiku',
      votes: { qa: 1, fact: 1, panel: 3, borderline: 3 },
      sha256,
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify({ seeds, files: Object.keys(sha256).length }));
