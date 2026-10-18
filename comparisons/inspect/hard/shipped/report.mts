import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wilson } from '../harness';
import { mcnemar } from './stats';

// Writes results.md for one result folder: scores, unscored counts, cost and a paired test per row.
// Usage: report.mts <dir under hard/> [title]
const hard = fileURLToPath(new URL('../', import.meta.url));
const dir = process.argv[2];
if (!dir) throw new Error('Usage: report.mts <dir under hard/> [title]');
type Result = { id: string; label: string; outcome: string; request_sha256: string[] };
type Summary = {
  procedure?: string;
  items: number;
  complete: number;
  right: number;
  inconclusive: number;
  costUsd: number;
  calls?: number;
  results: Result[];
};
const load = (row: string, name: string): Summary | undefined => {
  const path = `${hard}${dir}/${row}-${name}.json`;
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Summary) : undefined;
};
const labels: Record<string, string> = {
  audit: 'driftbench answer-audit (opt-in, this PR)',
  default: 'driftbench default',
  theirs: 'Inspect default',
};
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const lines = [`# ${process.argv[3] ?? 'Shipped judge against Inspect'}`, ''];
const names: Record<string, string> = {
  qa: 'Model-graded QA',
  fact: 'Model-graded fact',
  panel: 'Grader panel',
  borderline: 'Panel, borderline',
};
lines.push(
  'Model on every side: claude-haiku-5-5 through `claude -p`, same flags. An unscored or incomplete case counts as wrong.',
  '',
  '| Row | Procedure | Correct | 95% interval | Unscored | Calls | USD per 100 cases |',
  '|---|---|---|---|---|---|---|',
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
  for (const name of ['audit', 'default', 'theirs']) {
    const s = load(row, name);
    if (!s) continue;
    const ci = wilson(s.right, s.items);
    // Summaries written by the earlier runner carry no procedure name or call count.
    const procedure = labels[name] ?? s.procedure ?? name;
    const calls = s.calls ?? s.results.reduce((sum, r) => sum + r.request_sha256.length, 0);
    lines.push(
      `| ${names[row]} | ${procedure} | ${s.right}/${s.items} | ${pct(ci.lower)} to ${pct(ci.upper)} | ${s.inconclusive + s.items - s.complete} | ${calls} | ${((100 * s.costUsd) / s.items).toFixed(5)} |`,
    );
    if (name !== 'theirs' && theirs) {
      const t = mcnemar(s.results, theirs.results);
      tests.push(`| ${names[row]} | ${procedure} | ${t.first} | ${t.second} | ${t.p.toFixed(4)} |`);
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
for (const name of ['audit', 'default']) {
  const ours: Result[] = [];
  const theirs: Result[] = [];
  for (const row of ['panel', 'qa', 'fact', 'borderline']) {
    const a = load(row, name);
    const b = load(row, 'theirs');
    if (!a || !b) continue;
    ours.push(...a.results.map((r) => ({ ...r, id: `${row}:${r.id}` })));
    theirs.push(...b.results.map((r) => ({ ...r, id: `${row}:${r.id}` })));
  }
  if (!ours.length) continue;
  const t = mcnemar(ours, theirs);
  const right = (rs: Result[]) => rs.filter((r) => r.outcome === r.label).length;
  pooled.push(
    `| ${labels[name]} | ${right(ours)}/${ours.length} against ${right(theirs)}/${theirs.length} | ${t.first} | ${t.second} | ${t.p.toFixed(4)} |`,
  );
}
const all = [...lines, ...tests, ...pooled];
writeFileSync(`${hard}${dir}/results.md`, `${all.join('\n')}\n`);
console.log(all.join('\n'));
