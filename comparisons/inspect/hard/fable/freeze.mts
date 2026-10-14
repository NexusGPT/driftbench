import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPrompt } from '../../../../packages/judges/src/prompt';
import { type Case, generate, type Row, rows } from '../generate.mts';
import { promptFor, requestSha256 } from '../harness';
import { recordingLines } from '../recordings';
import { configs, requestFor } from './request';

// Freezes a set of cases that no procedure ever requested, built the way shipped/freeze-480.mts built the
// 480 set: walk seeds upward from a start value per row; take each item in generator order whose request
// on every procedure (this lane's five and Inspect's) is new and unique, until each family and label cell
// holds N items. No model outcome is read. Run once per set, before any call on it:
//   node --import tsx comparisons/inspect/hard/fable/freeze.mts practice 5 800001 810001 820001
//   node --import tsx comparisons/inspect/hard/fable/freeze.mts heldout-480 20 900001 910001 920001
const here = fileURLToPath(new URL('./', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const [name, per, qaStart, panelStart, borderlineStart, borderlinePer, panelPer] = process.argv.slice(2);
if (!name || !per || !qaStart || !panelStart || !borderlineStart)
  throw new Error(
    'Usage: freeze.mts <set name> <items per family and label> <qa and fact start seed> <panel start seed> <borderline start seed> [borderline items per family and label] [panel items per family and label]',
  );
const out = `${here}${name}/`;
if (existsSync(`${out}freeze.json`)) throw new Error(`The ${name} set is already frozen`);
mkdirSync(out, { recursive: true });
const perCell = Number(per);
// The borderline construction has 78 distinct submissions per cell, and some cells share them (a passing
// near-number case and a passing missing case are the same text). Earlier sets used most of them, so the
// borderline row may take fewer items per cell than the other rows. Its count is recorded in the manifest.
const perCellOf: Record<Row, number> = {
  qa: perCell,
  fact: perCell,
  panel: Number(panelPer ?? per),
  borderline: Number(borderlinePer ?? per),
};
const start: Record<Row, number> = {
  qa: Number(qaStart),
  fact: Number(qaStart),
  panel: Number(panelStart),
  borderline: Number(borderlineStart),
};
const seen = new Set<string>();
for (const root of ['../', '../shipped/', './'])
  for (const line of recordingLines(new URL(root, import.meta.url)))
    seen.add(JSON.parse(line).request_sha256 ?? JSON.parse(line).key);
// Every case of every earlier frozen set is excluded too, requested or not.
const sets = [
  ...['qa', 'fact', 'panel', 'borderline'].flatMap((row) => [
    `../${row}.json`,
    `../${row}-heldout.json`,
    `../shipped/heldout/${row}.json`,
    `../shipped/heldout-480/${row}.json`,
    `../scoped/${row}-heldout.json`,
    `../normalized/${row}-heldout.json`,
    `../compact/${row}-heldout.json`,
    `../deciding/${row}.json`,
  ]),
  ...readdirSync(here, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== name)
    .flatMap((dir) => ['qa', 'fact', 'panel', 'borderline'].map((row) => `./${dir.name}/${row}.json`)),
];
for (const path of sets)
  if (existsSync(`${here}${path}`))
    for (const c of JSON.parse(readFileSync(`${here}${path}`, 'utf8')) as Case[]) seen.add(c.submission);

const digests = (c: Case, row: Row) => [
  ...configs.map((config) => requestSha256(buildPrompt(requestFor(c, row, config)), 0)),
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
      if (list.length >= perCellOf[row]) continue;
      if (seen.has(c.submission)) continue;
      const keys = digests(c, row);
      if (keys.some((k) => seen.has(k) || taken.has(k))) continue;
      for (const k of keys) taken.add(k);
      list.push(c);
      cells.set(cell, list);
    }
    if (cells.size === 24 && [...cells.values()].every((l) => l.length === perCellOf[row])) break;
  }
  if (cells.size !== 24 || ![...cells.values()].every((l) => l.length === perCellOf[row]))
    throw new Error(`${row}: not enough never-requested items`);
  return { cases: [...cells.values()].flat(), seeds: [start[row], seed] };
};
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sha256: Record<string, string> = {};
const seeds: Record<string, [number, number]> = {};
// A row whose count is 0 is left out of the set: its construction space holds no fresh pool.
const frozenRows = rows.filter((row) => perCellOf[row] > 0);
for (const row of frozenRows) {
  const { cases, seeds: range } = pick(row);
  seeds[row] = range;
  writeFileSync(`${out}${row}.json`, `${JSON.stringify(cases, null, 2)}\n`);
  sha256[`comparisons/inspect/hard/fable/${name}/${row}.json`] = sha(`${out}${row}.json`);
}
for (const path of [
  ...[
    'generate.mts',
    'harness.ts',
    'recordings.ts',
    'qa-template.txt',
    'fact-template.txt',
    'instructions.txt',
  ].map((file) => `comparisons/inspect/hard/${file}`),
  ...['stats.ts'].map((file) => `comparisons/inspect/hard/shipped/${file}`),
  ...['record.ts', 'request.ts', 'run.mts', 'report.mts', 'freeze.mts'].map(
    (file) => `comparisons/inspect/hard/fable/${file}`,
  ),
])
  sha256[path] = sha(`${repo}${path}`);
const judgeSource = readdirSync(`${repo}packages/judges/src`, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => `${entry.parentPath.slice(repo.length)}/${entry.name}`)
  .sort();
const judgeSha256 = createHash('sha256')
  .update(judgeSource.map((path) => `${path}:${sha(`${repo}${path}`)}`).join('\n'))
  .digest('hex');
const dirty = execFileSync(
  'git',
  ['status', '--porcelain', '--', 'packages/judges', 'comparisons/inspect/hard'],
  {
    cwd: repo,
    encoding: 'utf8',
  },
)
  .split('\n')
  .filter(
    (line) =>
      line &&
      !line.includes(`fable/${name}/`) &&
      !line.includes('fable/calls') &&
      !line.includes('fable/.cache'),
  );
if (dirty.length) throw new Error(`Commit the judge and the harness before freezing:\n${dirty.join('\n')}`);
writeFileSync(
  `${out}freeze.json`,
  `${JSON.stringify(
    {
      frozenAt: new Date().toISOString(),
      harnessCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
      judgeSha256AtFreeze: judgeSha256,
      casesPerRow: Object.fromEntries(frozenRows.map((row) => [row, perCellOf[row] * 24])),
      rowsLeftOut: rows.filter((row) => perCellOf[row] === 0),
      preRegistration: {
        primary:
          'All frozen rows pooled, paired by case: driftbench default judge with the rendered record read into role-separated entries (split) against Inspect default. Exact two-sided McNemar test on discordant cases. Unscored or incomplete counts as wrong.',
        descriptive: 'Per-row counts and intervals, without a test.',
        runs: 'One run per procedure. No change to the judge, the requests or the set after this freeze.',
      },
      perFamilyAndLabel: perCellOf,
      seedRanges: seeds,
      selection: `Seeds walked upward from ${qaStart} (QA, fact), ${panelStart} (panel), ${borderlineStart} (borderline). Items taken in generator order when the request of every procedure (${configs.join(', ')}, theirs) is new and unique and the submission is in no earlier set, until each family and label cell holds its count (${rows.map((row) => `${row} ${perCellOf[row]}`).join(', ')}). No model outcome is read.`,
      procedures: {
        default:
          'driftbench default judge, the whole rendered record as one agent entry (the registered wiring of the shipped comparison)',
        split:
          'driftbench default judge, the rendered record read into role-separated entries, inputs and artifact (fable/record.ts), block scope',
        'split-conv': 'the same, with the criterion scoped to the whole conversation',
        rendered:
          'driftbench default judge plus the rendered-record rule (fable/request.ts), one agent entry',
        audit: 'driftbench answer-audit (opt-in)',
        theirs:
          'Inspect default: verbatim inspect_ai model_graded_qa and model_graded_fact templates pinned at a1dbea8',
      },
      judge:
        'Each run records the judge commit and the SHA-256 of packages/judges/src it ran under. A judge that runs on this set is frozen (committed) before its first call on it; one run per procedure and judge.',
      model: 'haiku',
      votes: { qa: 1, fact: 1, panel: 3, borderline: 3 },
      sha256,
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify({ name, seeds, files: Object.keys(sha256).length }));
