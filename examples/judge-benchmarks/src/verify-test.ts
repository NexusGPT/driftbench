import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { contestantById } from './contestants';
import { loadBenchmark, type PointItem, splitOf } from './data';
import { runBenchmark } from './run';
import { testMetrics } from './verify-test-metrics';

const folder = 'examples/judge-benchmarks/results/verify-dev';
const freeze = JSON.parse(await readFile(join(folder, 'freeze.json'), 'utf8')) as {
  sha: string;
  contestant: string;
  sampleIds: string[];
  hashes: Record<string, string>;
};
for (const [path, expected] of Object.entries(freeze.hashes)) {
  const actual = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
  if (actual !== expected) throw new Error(`Frozen artifact changed: ${path}`);
}
execFileSync('git', ['merge-base', '--is-ancestor', freeze.sha, 'HEAD']);
const benchmark = await loadBenchmark('longjudge-verify');
const population = benchmark.items.filter(
  (item) => splitOf('longjudge-verify', item.id) === 'test',
) as PointItem[];
const selected = population.filter((item) => freeze.sampleIds.includes(item.id));
if (selected.length !== freeze.sampleIds.length || new Set(freeze.sampleIds).size !== selected.length)
  throw new Error('Frozen sample does not match the TEST population.');
const audit = JSON.parse(await readFile(join(folder, 'test-label-audit.json'), 'utf8')) as {
  items: { id: string; verdict: string; audited_correct?: boolean }[];
};
const corrections = new Map(
  audit.items
    .filter((item) => item.verdict === 'proved_conflict')
    .map((item): [string, boolean] => {
      if (typeof item.audited_correct !== 'boolean') throw new Error('Invalid audited label.');
      return [item.id, item.audited_correct];
    }),
);
if (corrections.size !== 23 || [...corrections.values()].some((value) => typeof value !== 'boolean'))
  throw new Error('Unexpected frozen TEST audit shape.');
const recording = 'examples/judge-benchmarks/recordings/longjudge-verify/haiku.jsonl';
const baseline = execFileSync('git', ['show', `0fa48a41:${recording}`], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .trimEnd()
  .split('\n').length;
const spent = async () =>
  (await readFile(recording, 'utf8'))
    .trimEnd()
    .split('\n')
    .slice(baseline)
    .reduce((sum, line) => sum + Number(JSON.parse(line).costUsd ?? 0), 0);
const before = await spent();
const deadlineAt = Date.parse('2026-10-13T06:30:00+02:00');
if (before >= 7.97 || Date.now() >= deadlineAt)
  throw new Error('Budget or TEST deadline reached before start.');
// Exclusive marker prevents a second TEST evaluation, including an accidental rerun after interruption.
await writeFile(
  join(folder, 'test-started.json'),
  JSON.stringify(
    { freeze: freeze.sha, at: new Date().toISOString(), items: selected.length, before },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
const report = await runBenchmark({
  bench: 'longjudge-verify',
  model: 'haiku',
  contestants: [contestantById(freeze.contestant)],
  items: selected,
  criterion: benchmark.criterion,
  split: 'all',
  concurrency: 1,
  capUsd: 7.97 - before,
  deadlineAt,
  includeDecisions: true,
});
await writeFile(join(folder, 'test-result.json'), JSON.stringify(report, null, 2) + '\n');
const result = report.contestants[0];
if (!result) throw new Error('Frozen contestant report absent.');
const decisions = result.decisions ?? [];
const metrics = {
  freeze: freeze.sha,
  contestant: freeze.contestant,
  population: population.length,
  selected: selected.length,
  selectedInReport: report.items,
  judgmentsReturned: decisions.filter((d) => d.missing === 0).length,
  binaryVerdicts: decisions.filter((d) => d.pass !== undefined).length,
  stopped: report.stopped,
  official: testMetrics(population, decisions, new Map()),
  audited: testMetrics(population, decisions, corrections),
  auditCorrectionsInSample: selected.filter((item) => corrections.has(item.id)).length,
  costPer100Usd: (result.costUsd * 100) / report.items,
  newSpendUsd: report.newSpendUsd,
  taskRecordedSpendUsd: await spent(),
  partialCaveat: report.stopped
    ? 'Deadline or cap stopped the ordered sample. These are incomplete-sample results; its prefix is not a fresh random sample and population intervals are not valid.'
    : undefined,
};
await writeFile(join(folder, 'test-metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
console.log(JSON.stringify(metrics, null, 2));
if (process.env.VERIFY_SPEND_LEDGER)
  await appendFile(
    process.env.VERIFY_SPEND_LEDGER,
    `| ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })} | codex/verify-judge frozen TEST ${freeze.sha}, ${report.items}/${selected.length} items; official ${(100 * metrics.official.sampleAccuracy).toFixed(1)}, audited ${(100 * metrics.audited.sampleAccuracy).toFixed(1)} | haiku | ${report.newCalls} | ${(7.97 - before).toFixed(4)} remaining cap | ${report.newSpendUsd.toFixed(7)} | verify task ${metrics.taskRecordedSpendUsd.toFixed(7)} of 8 |\n`,
  );
