import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPrompt } from '../../../../packages/judges/src/prompt';
import { type Case, generate, type Row, rows } from '../generate.mts';
import { promptFor, requestSha256 } from '../harness';
import { recordingLines } from '../recordings';
import { requestFor } from './request';

// Second, larger held-out set: 480 cases per row, 20 passing and 20 failing per family, items never recorded.
// Run once, before any call on this set:  node --import tsx comparisons/inspect/hard/shipped/freeze-480.mts
// Selection rule, fixed before any outcome exists: walk seeds upward from the start value; take each item in
// generator order whose request on every procedure (audit, default, theirs) is new and unique, until its
// family and label cell holds 20. No model outcome is read.
const here = fileURLToPath(new URL('./', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const out = `${here}heldout-480/`;
if (existsSync(`${out}freeze.json`)) throw new Error('The 480 held-out set is already frozen');
mkdirSync(out, { recursive: true });
const perCell = 20;
const start: Record<Row, number> = { qa: 500001, fact: 500001, panel: 600001, borderline: 700001 };
const seen = new Set<string>();
for (const root of ['../', './'])
  for (const line of recordingLines(new URL(root, import.meta.url)))
    seen.add(JSON.parse(line).request_sha256 ?? JSON.parse(line).key);
for (const name of readdirSync(`${here}heldout`).filter((f) => /^(qa|fact|panel|borderline)\.json$/.test(f)))
  for (const c of JSON.parse(readFileSync(`${here}heldout/${name}`, 'utf8')) as Case[])
    seen.add(c.submission);

const digests = (c: Case, row: Row) => [
  requestSha256(buildPrompt(requestFor(c, row, 'audit')), 0),
  requestSha256(buildPrompt(requestFor(c, row, 'default')), 0),
  requestSha256(promptFor(c, row, 'theirs'), 0),
];
const pick = (row: Row): { cases: Case[]; seeds: [number, number] } => {
  const cells = new Map<string, Case[]>();
  const taken = new Set<string>();
  let seed = start[row];
  for (; seed < start[row] + 200000; seed++) {
    for (const c of generate(row, { seed, count: 60 })) {
      const cell = `${c.family}:${c.label}`;
      const list = cells.get(cell) ?? [];
      if (list.length >= perCell) continue;
      const keys = digests(c, row);
      if (keys.some((k) => seen.has(k) || taken.has(k))) continue;
      for (const k of keys) taken.add(k);
      list.push(c);
      cells.set(cell, list);
    }
    if (cells.size === 24 && [...cells.values()].every((l) => l.length === perCell)) break;
  }
  if (cells.size !== 24 || ![...cells.values()].every((l) => l.length === perCell))
    throw new Error(`${row}: not enough never-recorded items`);
  return { cases: [...cells.values()].flat(), seeds: [start[row], seed] };
};
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sha256: Record<string, string> = {};
const seeds: Record<string, [number, number]> = {};
for (const row of rows) {
  const { cases, seeds: range } = pick(row);
  seeds[row] = range;
  writeFileSync(`${out}${row}.json`, `${JSON.stringify(cases, null, 2)}\n`);
  sha256[`comparisons/inspect/hard/shipped/heldout-480/${row}.json`] = sha(`${out}${row}.json`);
}
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
  ...['run.mts', 'request.ts', 'report.mts', 'stats.ts', 'verify-freeze.mts', 'freeze-480.mts'].map(
    (name) => `comparisons/inspect/hard/shipped/${name}`,
  ),
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
  .filter((line) => line && !line.includes('shipped/heldout-480/') && !line.includes('shipped/calls'));
if (dirty.length) throw new Error(`Commit the judge and the harness before freezing:\n${dirty.join('\n')}`);
writeFileSync(
  `${out}freeze.json`,
  `${JSON.stringify(
    {
      frozenAt: new Date().toISOString(),
      judgeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
      casesPerRow: 480,
      perFamilyAndLabel: perCell,
      seedRanges: seeds,
      selection:
        'Seeds walked upward from 500001 (QA, fact), 600001 (panel), 700001 (borderline). Items taken in generator order when the request of every procedure is new and unique, until each family and label cell holds 20. No model outcome is read.',
      preRegistration: {
        primary:
          'All four rows pooled, paired by case: driftbench answer-audit against Inspect default. Exact two-sided McNemar test on discordant cases. Unscored or incomplete counts as wrong.',
        secondary: 'Same pooled test: driftbench default against Inspect default.',
        descriptive: 'Per-row counts and intervals, without a test.',
        runs: 'One run per procedure. No change to the judge, the requests or the set after this freeze.',
      },
      procedures: {
        audit: 'driftbench answer-audit (opt-in): assessment answer-audit of packages/judges at judgeCommit',
        default:
          'driftbench default: packages/judges default judge, criterion plus the submission as one agent entry',
        theirs:
          'Inspect default: verbatim inspect_ai model_graded_qa and model_graded_fact templates pinned at a1dbea8',
      },
      model: 'haiku',
      votes: { qa: 1, fact: 1, panel: 3, borderline: 3 },
      sha256,
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify({ seeds, files: Object.keys(sha256).length }));
