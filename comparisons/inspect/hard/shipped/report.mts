import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wilson } from '../harness';

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
const choose = (n: number, k: number) => {
  let value = 1;
  for (let i = 1; i <= k; i++) value = (value * (n - k + i)) / i;
  return value;
};
/** Exact two-sided McNemar test on the discordant pairs. */
export function mcnemar(a: Result[], b: Result[]) {
  const other = new Map(b.map((r) => [r.id, r]));
  let first = 0;
  let second = 0;
  for (const r of a) {
    const o = other.get(r.id);
    if (!o) throw new Error(`Unpaired case ${r.id}`);
    const x = r.outcome === r.label;
    const y = o.outcome === o.label;
    if (x && !y) first++;
    if (!x && y) second++;
  }
  const n = first + second;
  let tail = 0;
  for (let i = 0; i <= Math.min(first, second); i++) tail += choose(n, i) * 0.5 ** n;
  return { first, second, p: n === 0 ? 1 : Math.min(1, 2 * tail) };
}
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
    const procedure = s.procedure ?? 'Inspect default (recorded earlier)';
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
writeFileSync(`${hard}${dir}/results.md`, `${[...lines, ...tests].join('\n')}\n`);
console.log([...lines, ...tests].join('\n'));
