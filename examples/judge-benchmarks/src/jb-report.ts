/** Rebuild the task report from DEV recordings. Never makes a model call. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { contestantById } from './contestants';
import { runBenchmark } from './run';
import { scorePairs } from './score';

const output = 'examples/judge-benchmarks/jb-results';
const reportPath = process.env.JB_REPORT_PATH ?? `${output}/report.md`;
const audit = JSON.parse(await readFile(`${output}/label-audit.json`, 'utf8')) as {
  policy: string;
  excluded: { id: string; reason: string; source?: string; sources?: string[] }[];
};
const excluded = new Set(audit.excluded.map((x) => x.id));
const ids = ['driftbench-adaptive', 'driftbench-reference3', ...process.argv.slice(2)];
const rows: string[] = [];
const summaries: { id: string; official: number; audited: number; cost100: number; n: number }[] = [];
for (const id of ids) {
  const items: { id: string; correct: boolean; complete: boolean }[] = [];
  const r = await runBenchmark({
    bench: 'judgebench',
    model: 'haiku',
    split: 'dev',
    contestants: [contestantById(id)],
    replayOnly: true,
    concurrency: 1,
    onPairResult: (result) =>
      items.push({
        id: result.item.id,
        correct: scorePairs('judgebench', [result]).value.estimate === 1,
        complete: result.missing === 0,
      }),
  });
  if (r.stopped || r.failedCalls || r.contestants[0]?.summary.missing || items.some((i) => !i.complete))
    continue;
  const c = r.contestants[0];
  if (!c) continue;
  const kept = items.filter((i) => !excluded.has(i.id));
  const official = items.filter((i) => i.correct).length / items.length;
  const audited = kept.filter((i) => i.correct).length / kept.length;
  const cost100 = (c.costUsd / items.length) * 100;
  summaries.push({ id, official, audited, cost100, n: items.length });
  rows.push(
    `| ${id} | ${(100 * official).toFixed(1)} (${items.filter((i) => i.correct).length}/${items.length}) | ${(100 * audited).toFixed(1)} (${kept.filter((i) => i.correct).length}/${kept.length}) | ${cost100.toFixed(4)} | ${c.calls} | ${r.failedCalls} |`,
  );
}
summaries.sort((a, b) => b.official - a.official || a.cost100 - b.cost100);
const best = summaries[0];
const initial = new Set<string>(JSON.parse(await readFile(`${output}/starting-keys.json`, 'utf8')));
const newRows = (await readFile('examples/judge-benchmarks/recordings/judgebench/haiku.jsonl', 'utf8'))
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as { key: string; costUsd: number })
  .filter((r) => !initial.has(r.key));
const spent = newRows.reduce((n, r) => n + r.costUsd, 0);
const stamp = new Date().toISOString();
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
let heldout: Awaited<ReturnType<typeof runBenchmark>> | undefined;
try {
  heldout = JSON.parse(await readFile(`${output}/final-test.json`, 'utf8'));
} catch {
  /* Not run yet. */
}
const formatRows = summaries
  .filter((s) => s.id.endsWith('-format') || s.id.endsWith('-format-ledger'))
  .flatMap((withFormat) => {
    const withoutId =
      withFormat.id === 'driftbench-direct-format-ledger'
        ? 'driftbench-direct-ledger'
        : withFormat.id.replace(/-format$/, '');
    const without = summaries.find((s) => s.id === withoutId);
    return without
      ? [
          `| ${withoutId} | ${(100 * without.official).toFixed(1)} | ${(100 * withFormat.official).toFixed(1)} | ${(100 * without.audited).toFixed(1)} | ${(100 * withFormat.audited).toFixed(1)} | ${without.cost100.toFixed(4)} | ${withFormat.cost100.toFixed(4)} |`,
        ]
      : [];
  });
const mapping = JSON.parse(await readFile(`${output}/mapping-audit-summary.json`, 'utf8')) as {
  examined: number;
  flaggedCalls: number;
  flaggedItems: number;
};
const signals: Record<string, Record<string, number>> = {};
for (const id of ids) {
  try {
    const text = await readFile(`${output}/${id}-signals.jsonl`, 'utf8');
    const counts: Record<string, number> = {};
    for (const line of text.trim().split('\n').filter(Boolean)) {
      const s = JSON.parse(line) as { kind: string; status: string };
      const key = `${s.kind}: ${s.status}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    signals[id] = counts;
  } catch {
    /* A variant without an evidence log is not counted as executed. */
  }
}
const lines = [
  '# JudgeBench development report',
  '',
  `Snapshot: ${stamp}. Branch: codex/jb-judge. Head at report generation: ${sha}.`,
  '',
  best
    ? `Best complete official dev result: **${(best.official * 100).toFixed(1)} percent**, **${best.id}**, **${best.cost100.toFixed(4)} USD per 100 pairs**. Audited retained-label accuracy: ${(best.audited * 100).toFixed(1)} percent.`
    : 'No completed candidate result yet.',
  '',
  '## Scope and scoring',
  '',
  heldout
    ? '- All tuning and label-audit decisions use dev only. After freezing the configuration, one test run compares it with and without format parsing. No tuning follows that held-out run.'
    : '- All tuning and label inspection use the fixed dev split only. The authorized final test run has not started yet.',
  '- Every pair is judged in both orders using the existing JudgeBench net-vote metric. Official labels and competitor templates stay unchanged.',
  `- ${audit.policy}`,
  `- Official accuracy uses all 121 pairs. Audited accuracy uses the same official metric on the ${121 - excluded.size} retained pairs. It is a diagnostic subset score, not a replacement published benchmark score.`,
  '- Cost per 100 pairs includes every reference, review and judgement that the candidate needs, including replayed calls at their recorded original price. New task spend is counted separately.',
  '',
  '## Complete variants',
  '',
  '| Variant | Official accuracy percent | Audited accuracy percent | USD per 100 pairs | Recorded calls | Failed calls |',
  '|---|---|---|---|---|---|',
  ...rows,
  '',
  '## Format parser ablation on dev',
  '',
  '| Base configuration | Official without | Official with | Audited without | Audited with | USD/100 without | USD/100 with |',
  '|---|---|---|---|---|---|---|',
  ...formatRows,
  '',
  'The general compiler receives only the question and derives a pure check(response) function from an exact quoted instruction. The harness validates the quote and runs the checker on both proposals. The same judgement prompts and recordings are used with and without the format parser; only equal-correctness ties can change. Uncertain or failed format checks abstain. No rule names a dev item, expected letter or hidden label.',
  ...(heldout
    ? [
        '',
        '## One frozen held-out test run',
        '',
        '| Variant | Official test percent | USD per 100 pairs | Missing |',
        '|---|---|---|---|',
        ...heldout.contestants.map(
          (c) =>
            `| ${c.contestant} | ${(100 * c.summary.value.estimate).toFixed(1)} | ${((100 * c.costUsd) / heldout.items).toFixed(4)} | ${c.summary.missing} |`,
        ),
        '',
        'Audited test labels are unavailable: the audit was fixed on dev only. Test results are not used to select or edit a configuration.',
        ...(heldout.stopped
          ? [
              `The held-out run stops before full coverage: ${heldout.stopped}. These partial scores do not establish full test performance.`,
            ]
          : []),
      ]
    : []),
  '',
  '## Implemented mechanisms and measured variants',
  '',
  '| Variant | Change |',
  '|---|---|',
  '| adaptive | Existing route, one reference, three judgements in each order. |',
  '| reference3 | Existing single reference with three judgements per order. |',
  '| contrast | Falsify both proposed final answers, without anchoring on a third generated answer. |',
  '| direct | Name A or B directly; no pass/fail translation. |',
  '| direct-ledger | Replay the identical direct outputs; compute the winner from factual correctness fields. |',
  '| direct-format-ledger and -format counterparts | Replay the same judgements; derive a general format checker from quoted question-only instructions and use its executed checks only for equally correct finals. |',
  '| direct-strategy | Route computations to a blind Python solve plus a backward check of both proposals. Knowledge uses five distinct option-elimination methods. A reference is supplied only at unanimous agreement. Otherwise compare without it. |',
  '| direct-strategy3 | Same evidence, three independent ledgers per displayed order. |',
  '| direct-strategy5 | Same five independent solves, with a preselected four-of-five agreement gate. |',
  '| direct-divergence | Quote the earliest substantive computational disagreement, validate both quotes against their proposals, then focus the executable check on that subquestion. |',
  '',
  'Only complete variants in the score table are measured on the full dev split. Implemented but unrun candidates do not establish a gain. A twelve-pair stratified pilot checks the executable path before a full run.',
  '',
  '## Verdict mapping audit',
  '',
  `A conservative explicit-winner screen examines ${mapping.examined} dev pass/fail recordings. It flags ${mapping.flaggedCalls} calls across ${mapping.flaggedItems} items after review of qualified correctness statements. Two initial flags on one coding item are false positives: A works on small examples, but B wins on the required runtime constraints.`,
  '',
  'This screen does not establish the absence of subtle contradictions. It detects explicit reasoning that names the opposite winner; it does not repair old outcomes or change official scores. New direct contestants remove the pass/fail translation and test contradictory winner/ledger outputs in code.',
  '',
  '## Executed evidence coverage',
  '',
  ...Object.entries(signals).map(
    ([id, counts]) =>
      `- ${id}: ${Object.entries(counts)
        .map(([key, n]) => `${key} ${n}`)
        .join('; ')}.`,
  ),
  '',
  'Execution proves only the encoded computations and test inputs. Model-generated constraints and oracles can still be wrong. Exceptions, rejected operations, malformed JSON and timeouts provide no correctness signal; one repair uses the actual error, then the judge falls back without executable evidence.',
  '',
  '## Label audit',
  '',
  'These decisions are isolated in label-audit.json and never enter any model prompt. Exclusion reasons come from the supplied question, full candidate answers, arithmetic or the sources below.',
  '',
  '| Dev item | Evidence and audit decision |',
  '|---|---|',
  ...audit.excluded.map(
    (x) =>
      `| ${x.id} | ${x.reason} ${[...(x.sources ?? []), ...(x.source ? [x.source] : [])].map((s, i) => `[Source ${i + 1}](${s})`).join(' ')} |`,
  ),
  '',
  '## Verification and cost',
  '',
  '- The harness originally limited items but launched nested judgements in parallel. A call queue now makes --concurrency 1 serialize nested samples, candidate reviews and both orders.',
  '- Tests use fake model commands. They assert non-overlapping call time spans, spend-cap enforcement, identical content-linked review notes in both orders, strict-majority abstention, option aliases and decimal distinctions.',
  `- Recorded new task spend: ${spent.toFixed(8)} USD over ${newRows.length} successful recorded calls. Server restarts interrupted the first experiment twice. Their in-flight requests have no returned price; the driver reserves 0.15 USD for them and the last-call cap margin.`,
  '- Generated Python runs in an isolated temporary folder with a five-second limit, capped output and an AST guard restricting pure operations. On this macOS host, sandbox-exec additionally denies file writes, networking and child-process creation. Other hosts use only the AST guard, which is not an operating-system security boundary.',
  '- The paid strategy driver uses a per-call budget and the 07:00 Brussels deadline. No two real model calls run together.',
  '- Cache, temporary model folders, test fixtures and diagnostics stay inside this worktree. The shared spend ledger receives append-only run rows.',
  '',
  '## Best configuration and limits',
  '',
  best
    ? `Freeze contestant ${best.id} exactly as measured above. The fresh official dev metric, rather than audited accuracy, determines the selection. No test score is claimed.`
    : 'Wait for a complete development run before selecting a configuration.',
  '',
  'The label audit finds more uncertainty than the original two equal-answer pairs. A strict majority can still be confidently wrong because all solves use the same model. Reference omission reduces false authority; it does not create new domain knowledge.',
  '',
  'Source entry points and reproduction scripts are under examples/judge-benchmarks. Replay uses --split dev --replay-only --concurrency 1 and the frozen contestant id.',
  '',
];
await writeFile(reportPath, lines.join('\n'));
await writeFile(
  `${output}/summary.json`,
  JSON.stringify(
    { stamp, best, variants: summaries, spent, recordedCalls: newRows.length, excluded: [...excluded] },
    null,
    2,
  ),
);
console.log(JSON.stringify({ reportPath, best, spent }));
