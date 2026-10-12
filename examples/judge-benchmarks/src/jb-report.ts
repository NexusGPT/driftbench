/** Rebuild the task report from DEV recordings. Never makes a model call. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { cascadeConfig, runReferenceCascade } from './cascade-run';
import { contestantById } from './contestants';
import { type RunReport, runBenchmark } from './run';
import { type Summary, scorePairs } from './score';

const output = 'examples/judge-benchmarks/jb-results';
const reportPath = process.env.JB_REPORT_PATH ?? `${output}/report.md`;
const audit = JSON.parse(await readFile(`${output}/label-audit.json`, 'utf8')) as {
  policy: string;
  excluded: { id: string; reason: string; source?: string; sources?: string[] }[];
};
const excluded = new Set(audit.excluded.map((x) => x.id));
const ids = ['driftbench-adaptive', 'driftbench-reference3', ...process.argv.slice(2)];
const rows: string[] = [];
const summaries: {
  id: string;
  official: number;
  audited: number;
  cost100: number;
  n: number;
  escalated?: number;
  escalationShare?: number;
}[] = [];
for (const id of ids) {
  const items: { id: string; correct: boolean; complete: boolean }[] = [];
  const options = {
    bench: 'judgebench',
    model: 'haiku',
    split: 'dev',
    replayOnly: true,
    concurrency: 1,
    onPairResult: (result: import('./score').PairResult) =>
      items.push({
        id: result.item.id,
        correct: scorePairs('judgebench', [result]).value.estimate === 1,
        complete: result.missing === 0,
      }),
  } as const;
  const cascade = cascadeConfig(id);
  const r: RunReport & Partial<{ escalated: number; escalationShare: number }> = cascade
    ? await runReferenceCascade({ ...options, ...cascade })
    : await runBenchmark({ ...options, contestants: [contestantById(id)] });
  if (r.stopped || r.failedCalls || r.contestants[0]?.summary.missing || items.some((i) => !i.complete))
    continue;
  const c = r.contestants[0];
  if (!c) continue;
  const kept = items.filter((i) => !excluded.has(i.id));
  const official = items.filter((i) => i.correct).length / items.length;
  const audited = kept.filter((i) => i.correct).length / kept.length;
  const cost100 = (c.costUsd / items.length) * 100;
  summaries.push({
    id,
    official,
    audited,
    cost100,
    n: items.length,
    ...(r.escalated !== undefined ? { escalated: r.escalated, escalationShare: r.escalationShare } : {}),
  });
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
let testAudit:
  | {
      sample: { n: number; population: number; seed: string; groups: unknown };
      audit: { policy: string; excluded: { id: string; reason: string; sources?: string[] }[] };
      rows: { id: string; official: Summary; audited: Summary; cost100: number }[];
      interval: string;
    }
  | undefined;
let freeze: { sha: string; stamp: string; ids: string[]; sample: number } | undefined;
const controlRows: string[] = [];
for (const id of [
  'driftbench-reference3-tools',
  'driftbench-reference3-tools-format',
  'driftbench-reference3-tools-cascade',
  'driftbench-reference3-tools-format-cascade',
]) {
  try {
    const r = JSON.parse(await readFile(`${output}/${id}-sample-50.json`, 'utf8')) as RunReport & {
      escalated?: number;
    };
    const decisions = JSON.parse(
      await readFile(`${output}/${id}-sample-50-decisions.json`, 'utf8'),
    ) as import('./score').PairResult[];
    const c = r.contestants[0];
    if (!c || r.stopped || r.failedCalls || c.summary.missing || decisions.length !== 50) continue;
    const audited = scorePairs(
      'judgebench',
      decisions.filter((x) => !excluded.has(x.item.id)),
    );
    controlRows.push(
      `| ${id} | 50 | ${(100 * c.summary.value.estimate).toFixed(1)} | ${(100 * c.summary.value.lower).toFixed(1)} to ${(100 * c.summary.value.upper).toFixed(1)} | ${(100 * audited.value.estimate).toFixed(1)} (${audited.n} retained) | ${r.escalated ?? 50}/50 | ${((100 * c.costUsd) / 50).toFixed(4)} |`,
    );
  } catch {
    /* No complete stratified control yet. */
  }
}
try {
  heldout = JSON.parse(await readFile(`${output}/final-test.json`, 'utf8'));
} catch {
  /* Not run yet. */
}
try {
  testAudit = JSON.parse(await readFile(`${output}/final-test-audited.json`, 'utf8'));
} catch {
  /* Audit not written yet. */
}
try {
  freeze = JSON.parse(await readFile(`${output}/freeze.json`, 'utf8'));
} catch {
  /* Design not frozen yet. */
}
const formatRows = summaries
  .filter((s) => s.id.includes('-format'))
  .flatMap((withFormat) => {
    const withoutId =
      withFormat.id === 'driftbench-direct-format-ledger'
        ? 'driftbench-direct-ledger'
        : withFormat.id.replace('-format', '');
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
  'The general compiler receives only the question and derives a pure check(response) function from an exact quoted instruction. The harness validates the quote and runs the checker on both proposals. Whole-string matchers receive a second question-only code review, so final-answer instructions do not accidentally restrict all reasoning. The same judgement prompts and recordings are used with and without the format parser. Direct-ledger variants require both factual checks to be true. The original reference3 variant requires the two extracted final answers to be equivalent. Uncertain or failed format checks abstain. No rule names a dev item, expected letter or hidden label.',
  '',
  '## Cascade against full escalation on dev',
  '',
  '| Configuration | Official percent | Audited percent | Escalated pairs | Escalated share percent | USD per 100 pairs |',
  '|---|---|---|---|---|---|',
  ...summaries
    .filter((s) => s.escalated !== undefined)
    .map(
      (s) =>
        `| ${s.id} | ${(100 * s.official).toFixed(1)} | ${(100 * s.audited).toFixed(1)} | ${s.escalated}/${s.n} | ${(100 * (s.escalationShare ?? 0)).toFixed(1)} | ${s.cost100.toFixed(4)} |`,
    ),
  ...summaries
    .filter((s) => s.id.startsWith('driftbench-reference3-tools') && !cascadeConfig(s.id))
    .map(
      (s) =>
        `| ${s.id} full escalation | ${(100 * s.official).toFixed(1)} | ${(100 * s.audited).toFixed(1)} | ${s.n}/${s.n} | 100.0 | ${s.cost100.toFixed(4)} |`,
    ),
  '',
  'The cascade runs unchanged reference3 reasoning first. It escalates parsed reference disagreement with both finals, split order-normalized sample categories, low recorded verdict confidence, inconclusive base outcomes or explicit reference uncertainty. The default confidence threshold is 0.75; globally chosen dev alternatives show their percentage in the configuration suffix. Missing answer extraction alone does not trigger escalation. Labels, group, answer length and the preferred letter never enter the gate. The format variant applies the same question-only checker to both stages. Cascade cost includes base plus selected escalation; full escalation cost includes only its standalone evidence and judgements.',
  ...(controlRows.length
    ? [
        '',
        '### Stratified control measured before the complete run',
        '',
        'These configurations use the same 50 dev pairs, sampled proportionally by source with seed codex-jb-control-v1. The sample does not select the best full-dev configuration.',
        '',
        '| Configuration | Pairs | Official percent | 95 percent interval | Audited percent | Escalated | USD per 100 pairs |',
        '|---|---|---|---|---|---|---|',
        ...controlRows,
      ]
    : []),
  ...(heldout
    ? [
        '',
        '## One frozen held-out test run',
        '',
        `Frozen design commit: ${freeze?.sha ?? 'unavailable'}. Freeze time: ${freeze?.stamp ?? 'unavailable'}.`,
        '',
        '| Variant | Official test percent | 95 percent interval | Audited test percent | Audited 95 percent interval | USD per 100 pairs | Missing |',
        '|---|---|---|---|---|---|---|',
        ...heldout.contestants.map((c) => {
          const audited = testAudit?.rows.find((r) => r.id === c.contestant)?.audited;
          return `| ${c.contestant} | ${(100 * c.summary.value.estimate).toFixed(1)} (${Math.round(c.summary.value.estimate * c.summary.n)}/${c.summary.n}) | ${(100 * c.summary.value.lower).toFixed(1)} to ${(100 * c.summary.value.upper).toFixed(1)} | ${audited ? `${(100 * audited.value.estimate).toFixed(1)} (${Math.round(audited.value.estimate * audited.n)}/${audited.n})` : 'audit pending'} | ${audited ? `${(100 * audited.value.lower).toFixed(1)} to ${(100 * audited.value.upper).toFixed(1)}` : 'pending'} | ${((100 * c.costUsd) / heldout.items).toFixed(4)} | ${c.summary.missing} |`;
        }),
        '',
        testAudit
          ? `The frozen stratified selection contains ${testAudit.sample.n} of ${testAudit.sample.population} held-out pairs, seed ${testAudit.sample.seed}. ${testAudit.interval}`
          : `The one-shot held-out evaluation contains ${heldout.items} pairs. Its documented audit is pending.`,
        ...(testAudit
          ? [
              '',
              `Sampling groups: ${JSON.stringify(testAudit.sample.groups)}.`,
              '',
              '### Test label audit',
              '',
              testAudit.audit.policy,
              '',
              '| Test item | Evidence and audit decision |',
              '|---|---|',
              ...testAudit.audit.excluded.map(
                (x) =>
                  `| ${x.id} | ${x.reason} ${(x.sources ?? []).map((s, i) => `[Source ${i + 1}](${s})`).join(' ')} |`,
              ),
            ]
          : []),
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
  '| reference3-tools | Preserve reference3 reasoning; add five decorrelated blind solves, unanimous reference gating, arithmetic/code execution, backward candidate checks and a directly named winner. Code computes unequal factual verdicts. |',
  '| reference3-tools-cascade | Run original reference3, then run tools only on its label-blind uncertainty signals. |',
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
  `- Recorded new task spend: ${spent.toFixed(8)} USD over ${newRows.length} successful recorded calls. Server restarts interrupted the first experiment twice. A later development caller is stopped once to prioritize completed cascade and format candidates before the freeze. Their in-flight requests have no returned price; the driver reserves 0.20 USD for them and the last-call cap margin.`,
  '- Generated Python runs in an isolated temporary folder with a five-second limit, capped output and an AST guard restricting pure operations. On this macOS host, sandbox-exec additionally denies file writes, networking and child-process creation. Other hosts use only the AST guard, which is not an operating-system security boundary.',
  '- The design freezes by 04:30 Brussels. The one-shot held-out runner validates source hashes and stops new or in-flight model calls by 06:30. No two real model calls run together.',
  '- Model cache, model runtime folders and diagnostics stay inside this worktree. Initial unit fixtures use the host temporary folder and clean up after verification; subsequent verification sets TMPDIR inside this worktree. The shared spend ledger receives append-only run rows.',
  '',
  '## Best configuration and limits',
  '',
  best
    ? `${freeze ? `Frozen configurations: ${freeze.ids.join(', ')} at ${freeze.sha}.` : `Leading complete contestant: ${best.id}.`} The official dev metric determines selection. ${heldout ? 'No configuration changes follow the held-out run.' : 'The held-out run has not started.'}`
    : 'Wait for a complete development run before selecting a configuration.',
  '',
  'The label audit finds more uncertainty than the original two equal-answer pairs. A strict majority can still be confidently wrong because all solves use the same model. Reference omission reduces false authority; it does not create new domain knowledge.',
  '',
  'Source entry points and reproduction scripts are under examples/judge-benchmarks. Individual contestants replay through run.ts with --split dev --replay-only --concurrency 1. Cascades replay through runReferenceCascade or jb-dev-cascade.ts with JB_REPLAY_ONLY=1 and the recorded configuration id. The latter uses the task spend-ledger and starting-key snapshot for bookkeeping.',
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
