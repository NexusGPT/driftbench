import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson } from '../harness';
import { mcnemar } from '../shipped/stats';

// Writes results.md for one result folder: scores, unscored counts, cost, a paired test per row and pooled.
// Usage: report.mts <dir under fable/> [title]
const here = fileURLToPath(new URL('./', import.meta.url));

type Result = { id: string; label: string; outcome: string; complete?: boolean; request_sha256: string[] };
type Case = { id: string; label: string; submission: string; question: string };
type Pair = { submission: string; ours: boolean; theirs: boolean };
const scored = (rs: Result[]) =>
  rs.map((r) => ({ ...r, outcome: r.complete === false ? 'inconclusive' : r.outcome }));
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
/** Exact two-sided sign permutation: one shared sign per exact submission text.
 * The statistic is the row-weighted correctness difference. Cluster sums of zero
 * have no effect. BigInt counts keep the permutation distribution exact.
 */
export function clusteredExact(pairs: Pair[]) {
  const groups = new Map<string, number>();
  for (const pair of pairs)
    groups.set(pair.submission, (groups.get(pair.submission) ?? 0) + Number(pair.ours) - Number(pair.theirs));
  const deltas = [...groups.values()].filter((delta) => delta !== 0);
  const observed = Math.abs(deltas.reduce((sum, delta) => sum + delta, 0));
  let distribution = new Map<number, bigint>([[0, 1n]]);
  for (const delta of deltas) {
    const next = new Map<number, bigint>();
    for (const [total, ways] of distribution)
      for (const sign of [-1, 1]) {
        const value = total + sign * delta;
        next.set(value, (next.get(value) ?? 0n) + ways);
      }
    distribution = next;
  }
  const extreme = [...distribution].reduce(
    (sum, [total, ways]) => sum + (Math.abs(total) >= observed ? ways : 0n),
    0n,
  );
  const permutations = 2n ** BigInt(deltas.length);
  return {
    clusters: groups.size,
    nonzero: deltas.length,
    observed,
    extreme,
    permutations,
    p: Number(extreme) / Number(permutations),
  };
}

export function overlap(practice: Case[], heldout: Case[]) {
  const submissions = new Set(practice.map((c) => c.submission));
  const questions = new Set(practice.map((c) => c.question));
  const shared = heldout.filter((c) => questions.has(c.question));
  return {
    submissions: heldout.filter((c) => submissions.has(c.submission)).length,
    rows: shared.length,
    questions: new Set(shared.map((c) => c.question)).size,
  };
}

export function generateReport(dir: string, title = 'Shipped judge against Inspect, this lane') {
  const manifest = JSON.parse(readFileSync(`${here}recordings-manifest.json`, 'utf8')) as {
    files: { path: string }[];
  };
  for (const file of manifest.files.filter((f) => f.path.startsWith(`${dir}/`))) {
    if (!existsSync(`${here}${file.path}`))
      throw new Error(`Missing recording ${file.path}; run export-recordings.mts first`);
  }
  const procedures = ['default', 'split', 'split-conv', 'split-r2', 'rendered', 'audit'];
  const load = (row: string, name: string): Summary | undefined => {
    const path = `${here}${dir}/${row}-${name}.json`;
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Summary) : undefined;
  };
  const pvalue = (p: number) => (p === 0 ? '0' : p < 0.001 ? p.toPrecision(8) : p.toFixed(8));
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const lines = [`# ${title}`, ''];
  const names: Record<string, string> = {
    qa: 'Model-graded QA',
    fact: 'Model-graded fact',
    panel: 'Grader panel',
    borderline: 'Panel, borderline',
  };
  lines.push(
    'Model on every side: claude-haiku-5-5, through `claude -p` with the flags of the judges package or through the Messages API with the same texts (transport counts and attribution are in [the provenance record](../transport.md); raw recordings are restored with [the export script](../README.md)). An unscored or incomplete case counts as wrong.',
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
        const t = mcnemar(scored(s.results), scored(theirs.results));
        tests.push(`| ${names[row]} | ${s.procedure ?? name} | ${t.first} | ${t.second} | ${pvalue(t.p)} |`);
      }
    }
  }
  const pooled = [
    '',
    dir === 'heldout-480'
      ? '## Primary pooled result: clustered exact test'
      : '## Pooled over available rows',
    '',
    (dir === 'heldout-480'
      ? 'Post-hoc correction of the pre-registered pooled test: pooling double-counted submissions shared by QA and fact. '
      : 'Clustered exact test across the available rows. ') +
      'Keep every copy of an identical submission together under one random sign. The test statistic is the total correctness difference across rows; the two-sided p-value sums permutations at least as extreme in absolute value. Unscored or incomplete cases count as wrong.',
    '',
    `| Procedure | Correct | Only ours | Only Inspect | Distinct submissions | Clustered p${dir === 'heldout-480' ? ' (primary)' : ''} | ${dir === 'heldout-480' ? 'Nominal McNemar p (uncorrected)' : 'McNemar p'} |`,
    '|---|---|---|---|---|---|---|',
  ];
  for (const name of procedures) {
    const ours: Result[] = [];
    const pairs: Pair[] = [];
    const theirs: Result[] = [];
    let label = name;
    for (const row of ['panel', 'qa', 'fact', 'borderline']) {
      const a = load(row, name);
      const b = load(row, 'theirs');
      if (!a || !b) continue;
      label = (a.procedure ?? name).replace(/, three votes.*$/, '');
      const cases = JSON.parse(readFileSync(`${here}${dir}/${row}.json`, 'utf8')) as Case[];
      const left = new Map(a.results.map((r) => [r.id, r]));
      const right = new Map(b.results.map((r) => [r.id, r]));
      if (left.size !== cases.length || right.size !== cases.length) throw new Error(`Incomplete row ${row}`);
      for (const c of cases) {
        const x = left.get(c.id);
        const y = right.get(c.id);
        if (!x || !y || x.label !== c.label || y.label !== c.label) throw new Error(`Unpaired case ${c.id}`);
        pairs.push({
          submission: c.submission,
          ours: x.complete !== false && x.outcome === c.label,
          theirs: y.complete !== false && y.outcome === c.label,
        });
      }

      ours.push(...a.results.map((r) => ({ ...r, id: `${row}:${r.id}` })));
      theirs.push(...b.results.map((r) => ({ ...r, id: `${row}:${r.id}` })));
    }
    if (!ours.length) continue;
    const t = mcnemar(scored(ours), scored(theirs));
    const clustered = clusteredExact(pairs);
    const right = (rs: Result[]) => rs.filter((r) => r.complete !== false && r.outcome === r.label).length;
    pooled.push(
      `| ${label} | ${right(ours)}/${ours.length} against ${right(theirs)}/${theirs.length} | ${t.first} | ${t.second} | ${clustered.clusters} | ${pvalue(clustered.p)} | ${pvalue(t.p)} |`,
    );
  }
  if (dir === 'heldout-480')
    pooled.push(
      '',
      'The pooled lead is not significant at 0.05 (clustered p = 0.07199961598962545). The nominal pre-registered McNemar p = 0.03153949735315109 treated 1,440 row observations as independent pairs, although they contain only 960 distinct submissions. All 480 QA submission texts also occur in fact, with identical split-judge request hashes and recorded answers. All nine fact-only wins are among the 20 QA-only wins. The corrected test is post hoc; the original registration remains unchanged.',
      '',
      'The per-row tests are retained as post-hoc analyses (the registration specified descriptive row counts). QA is a significant lead on 480 distinct submissions: 480 against 460, discordance 20/0, exact p = 0.0000019073486328125. Fact is 480 against 471, p = 0.00390625, but reuses the QA submissions and split answers; it is not an independent replication. Panel is 466 against 480, p = 0.0001220703125.',
    );
  if (dir === 'heldout-panel') {
    const readCases = (path: string) =>
      JSON.parse(readFileSync(`${here}${path}/panel.json`, 'utf8')) as Case[];
    const heldout = readCases(dir);
    const shared = overlap(readCases('practice-panel'), heldout);
    pooled.push(
      '',
      '## Practice overlap',
      '',
      `The second panel round has ${shared.submissions} exact submission overlaps with panel practice. However, ${shared.rows} of ${heldout.length} held-out rows share question text with panel practice, spanning ${shared.questions} shared distinct questions. These are fresh submissions, not an independent holdout of question texts. The 479/480 against 479/480 result is a tie, with no evidence of a lead.`,
    );
  }
  return `${[...lines, ...pooled, ...tests].join('\n')}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage: report.mts <dir under fable/> [title]');
  const report = generateReport(dir, process.argv[3]);
  writeFileSync(`${here}${dir}/results.md`, report);
  console.log(report);
}
