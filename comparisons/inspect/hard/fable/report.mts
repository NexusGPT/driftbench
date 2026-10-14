import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wilson } from '../harness';
import { mcnemar } from '../shipped/stats';

// Writes results.md for one result folder: scores, unscored counts, cost, a paired test per row and pooled.
// Usage: report.mts <dir under fable/> [title]
const here = fileURLToPath(new URL('./', import.meta.url));
const dir = process.argv[2];
if (!dir) throw new Error('Usage: report.mts <dir under fable/> [title]');
type Result = { id: string; label: string; outcome: string; request_sha256: string[] };
type Summary = {
  procedure?: string;
  judgeCommit?: string;
  items: number;
  complete: number;
  right: number;
  inconclusive: number;
  costUsd: number;
  calls?: number;
  results: Result[];
};
const procedures = ['default', 'split', 'split-conv', 'split-r2', 'rendered', 'audit'];
const load = (row: string, name: string): Summary | undefined => {
  const path = `${here}${dir}/${row}-${name}.json`;
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Summary) : undefined;
};
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const lines = [`# ${process.argv[3] ?? 'Shipped judge against Inspect, this lane'}`, ''];
const names: Record<string, string> = {
  qa: 'Model-graded QA',
  fact: 'Model-graded fact',
  panel: 'Grader panel',
  borderline: 'Panel, borderline',
};
lines.push(
  'Model on every side: claude-haiku-5-5, through `claude -p` with the flags of the judges package or through the Messages API with the same texts (each recorded call names its transport). An unscored or incomplete case counts as wrong.',
  '',
  '| Row | Procedure | Judge commit | Correct | 95% interval | Unscored | Calls | USD per 100 cases |',
  '|---|---|---|---|---|---|---|---|',
);
const tests = [
  '',
  '## Paired tests',
  '',
  'Exact two-sided McNemar test on the same cases. "Only ours" counts cases the driftbench procedure gets right and Inspect gets wrong.',
  '',
  '| Row | Procedure against Inspect | Only ours | Only Inspect | p |',
  '|---|---|---|---|---|',
];
for (const row of ['panel', 'qa', 'fact', 'borderline']) {
  const theirs = load(row, 'theirs');
  for (const name of [...procedures, 'theirs']) {
    const s = load(row, name);
    if (!s) continue;
    const ci = wilson(s.right, s.items);
    const calls = s.calls ?? s.results.reduce((sum, r) => sum + r.request_sha256.length, 0);
    lines.push(
      `| ${names[row]} | ${s.procedure ?? name} | ${name === 'theirs' ? '' : (s.judgeCommit ?? '').slice(0, 9)} | ${s.right}/${s.items} | ${pct(ci.lower)} to ${pct(ci.upper)} | ${s.inconclusive + s.items - s.complete} | ${calls} | ${((100 * s.costUsd) / s.items).toFixed(5)} |`,
    );
    if (name !== 'theirs' && theirs) {
      const t = mcnemar(s.results, theirs.results);
      tests.push(`| ${names[row]} | ${s.procedure ?? name} | ${t.first} | ${t.second} | ${t.p.toFixed(4)} |`);
    }
  }
}
const pooled = [
  '',
  '## Pooled over the four rows',
  '',
  'All rows together, paired by case. Exact two-sided McNemar test against Inspect.',
  '',
  '| Procedure | Correct | Only ours | Only Inspect | p |',
  '|---|---|---|---|---|',
];
for (const name of procedures) {
  const ours: Result[] = [];
  const theirs: Result[] = [];
  let label = name;
  for (const row of ['panel', 'qa', 'fact', 'borderline']) {
    const a = load(row, name);
    const b = load(row, 'theirs');
    if (!a || !b) continue;
    label = (a.procedure ?? name).replace(/, three votes.*$/, '');
    ours.push(...a.results.map((r) => ({ ...r, id: `${row}:${r.id}` })));
    theirs.push(...b.results.map((r) => ({ ...r, id: `${row}:${r.id}` })));
  }
  if (!ours.length) continue;
  const t = mcnemar(ours, theirs);
  const right = (rs: Result[]) => rs.filter((r) => r.outcome === r.label).length;
  pooled.push(
    `| ${label} | ${right(ours)}/${ours.length} against ${right(theirs)}/${theirs.length} | ${t.first} | ${t.second} | ${t.p.toFixed(4)} |`,
  );
}
const all = [...lines, ...tests, ...pooled];
writeFileSync(`${here}${dir}/results.md`, `${all.join('\n')}\n`);
console.log(all.join('\n'));
