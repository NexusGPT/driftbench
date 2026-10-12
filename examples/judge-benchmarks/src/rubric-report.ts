import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contestantById } from './contestants';
import { type ContestantReport, RECORDINGS, type RunReport } from './run';

/** Rebuild the handover from completed full-dev runs, retaining partial attempts separately. */
async function main(): Promise<void> {
  const reportPath = process.argv[2];
  if (!reportPath) throw new Error('Pass the authorized report path');
  const directory = join(fileURLToPath(new URL('..', import.meta.url)), 'experiments', 'rb');
  const completed = new Map<string, ContestantReport>();
  const partial: { file: string; items: number; missing: number; stopped?: string }[] = [];
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.json') || file === 'audit.json') continue;
    const report = JSON.parse(await readFile(join(directory, file), 'utf8')) as Partial<RunReport>;
    if (!Array.isArray(report.contestants)) continue;
    for (const contestant of report.contestants) {
      if (report.items === 357 && contestant.summary.missing === 0 && !report.stopped)
        completed.set(contestant.contestant, contestant);
    }
    if (report.stopped || report.items !== 357 || report.contestants.some((c) => c.summary.missing > 0))
      partial.push({
        file,
        items: report.items ?? 0,
        missing: report.contestants.reduce((n, c) => n + c.summary.missing, 0),
        ...(report.stopped ? { stopped: report.stopped } : {}),
      });
  }
  const rows = [...completed.values()].sort(
    (a, b) =>
      b.summary.value.estimate - a.summary.value.estimate ||
      (a.uniqueCostUsd ?? a.costUsd) - (b.uniqueCostUsd ?? b.costUsd),
  );
  const ours = rows.filter((r) => r.contestant.startsWith('driftbench'));
  const best = ours[0];
  if (!best) throw new Error('No completed driftbench dev configuration');
  const bestCost = ((best.uniqueCostUsd ?? best.costUsd) / 357) * 100;
  const config = contestantById(best.contestant);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const recording = await readFile(join(RECORDINGS, 'rubricbench', 'haiku.jsonl'), 'utf8');
  const newRows = recording
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { contestant?: string; costUsd: number })
    .filter((r) => r.contestant?.startsWith('driftbench-rb-') || r.contestant === 'driftbench-checklist');
  const spend = newRows.reduce((a, b) => a + b.costUsd, 0);
  const freeze = {
    contestant: best.contestant,
    model: 'haiku',
    split: 'dev',
    samples: config.samples ?? 1,
    canonicalOrder: config.canonicalOrder ?? false,
    source: config.source,
    devScore: best.summary.value.estimate,
    usdPer100: bestCost,
    newTaskSpendUsd: spend,
    measuredAt: new Date().toISOString(),
    testEvaluated: false,
  };
  await writeFile(join(directory, 'best-config.json'), `${JSON.stringify(freeze, null, 2)}\n`);
  const lines = [
    '# RubricBench dev experiment',
    '',
    `Measured at ${freeze.measuredAt}. Branch: codex/rb-judge. Head: ${head}.`,
    '',
    `Best completed full-dev config: **${best.contestant}**, **${(best.summary.value.estimate * 100).toFixed(4)}%**, **$${bestCost.toFixed(6)} per 100 items**.`,
    `The 90% target is ${best.summary.value.estimate >= 0.9 ? 'met on dev' : 'not met on dev'}. The test split remains untouched.`,
    `Recorded task spend: $${spend.toFixed(6)} across ${newRows.length} new recorded calls. Aborted calls without a returned cost cannot be metered from this harness.`,
    '',
    '| Completed variant | Dev items | Game accuracy | Position consistency | USD per 100 items | Unique calls |',
    '|---|---:|---:|---:|---:|---:|',
    ...rows.map(
      (r) =>
        `| ${r.contestant} | ${r.summary.n} | ${(100 * r.summary.value.estimate).toFixed(4)}% | ${r.summary.positionConsistency === undefined ? 'n/a' : `${(100 * r.summary.positionConsistency).toFixed(2)}%`} | ${(((r.uniqueCostUsd ?? r.costUsd) / 357) * 100).toFixed(6)} | ${r.uniqueCalls ?? r.calls} |`,
    ),
    '',
    '## Best config by domain',
    '',
    '| Dataset domain | Items | Dev accuracy |',
    '|---|---:|---:|',
    ...Object.entries(best.summary.byGroup).map(
      ([name, group]) => `| ${name} | ${group.n / 2} | ${(group.value * 100).toFixed(4)}% |`,
    ),
    '',
    '## What changed and why',
    '',
    '- Atomic grading records evidence and a score for each expert requirement for both replies. Arithmetic runs in TypeScript, not in the model.',
    '- Binary, equal-weight partial credit, importance-weighted partial credit and holistic aggregation share exact prompts. Their comparisons replay the same answers for free.',
    '- Literal grading restricts evaluation to the rubric. Contrast grading compares degree of fulfillment within each rubric. The contract variant also checks explicit user constraints omitted by the rubric.',
    '- Canonical presentation sorts responses by their content hashes, with no label, item id or domain input. Both caller orders map back to the original replies and share their recorded judgment.',
    '- Independent repeats and the prompt ensemble test whether additional judgments resolve remaining errors. Competitor templates stay unchanged.',
    '',
    `The selected configuration uses ${config.samples ?? 1} judgment(s) per prompt and ${config.canonicalOrder ? 'canonical presentation' : 'the original presentation rules'}. Its measured score and domain rows above are the evidence for choosing it.`,
    '',
    'Canonical position consistency is guaranteed by preprocessing. It is not evidence that the underlying model is immune to ordering. The two reported games reuse one judgment and are not independent observations.',
    'Cost counts unique recorded prompt keys within a contestant. The legacy costUsd field counts both game requests, including cache hits, and can therefore double-count canonical judgments. uniqueCostUsd is the reproduction cost used here.',
    '',
    '## Reproduce',
    '',
    '```sh',
    `pnpm exec tsx examples/judge-benchmarks/src/run.ts --bench rubricbench --model haiku --split dev --contestants ${best.contestant} --concurrency 1 --replay-only`,
    'pnpm exec vitest run examples/judge-benchmarks --maxWorkers=2',
    'pnpm exec tsc -p tsconfig.json --noEmit',
    '```',
    '',
    'The inference prompts and frozen best config are saved under examples/judge-benchmarks. Raw source dataset rows stay in the ignored local cache. No packages or competitor templates change.',
    '',
    '## Partial attempts',
    '',
    'Partial reports never select the best config. Their scores include missing answers and are not full-dev measurements.',
    '',
    '| Report | Requested items | Missing answers across variants | Stop |',
    '|---|---:|---:|---|',
    ...partial.map(
      (p) => `| ${p.file} | ${p.items} | ${p.missing} | ${p.stopped ?? 'partial recording coverage'} |`,
    ),
    '',
  ];
  await writeFile(reportPath, `${lines.join('\n')}\n`);
  console.log(JSON.stringify({ reportPath, best: freeze, head }));
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
