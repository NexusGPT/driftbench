import { createHash } from 'node:crypto';
import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { contestantById } from './contestants';
import { loadBenchmark, type PointItem, splitOf } from './data';
import { runBenchmark } from './run';
import { TEST_SEED, testSample, testStratum } from './verify-test-metrics';

// Zero-call confirmation and sample preregistration. The caller commits the plan, then records its SHA.
const id = process.argv[2];
const size = Number(process.argv[3]);
if (!id || !Number.isInteger(size) || size < 4) throw new Error('Pass a contestant id and TEST sample size.');
if (Date.now() > Date.parse('2026-10-13T04:30:00+02:00')) throw new Error('Freeze deadline passed.');
const folder = 'examples/judge-benchmarks/results/verify-dev';
const report = await runBenchmark({
  bench: 'longjudge-verify',
  model: 'haiku',
  contestants: [contestantById(id)],
  split: 'dev',
  concurrency: 1,
  replayOnly: true,
  includeDecisions: true,
});
if (report.stopped || report.items !== 95 || report.newCalls || report.newSpendUsd)
  throw new Error(`Frozen DEV confirmation failed: ${report.stopped ?? JSON.stringify(report)}`);
await writeFile(join(folder, 'frozen-dev.json'), `${JSON.stringify(report, null, 2)}\n`);
const audit = JSON.parse(await readFile(join(folder, 'label-audit.json'), 'utf8')) as {
  id: string;
  audited: boolean;
}[];
const changes = new Map(audit.map((item) => [item.id, item.audited]));
const c = report.contestants[0];
if (!c?.decisions) throw new Error('DEV confirmation lacks decisions.');
const right = c.decisions.filter((d) => d.pass === (changes.get(d.id) ?? d.correct)).length;
const benchmark = await loadBenchmark('longjudge-verify');
const population = benchmark.items.filter(
  (item) => splitOf('longjudge-verify', item.id) === 'test',
) as PointItem[];
const sample = testSample(population, size);
for (const stratum of new Set(population.map(testStratum))) {
  if (!sample.some((item) => testStratum(item) === stratum))
    throw new Error(`Sample omits stratum ${stratum}; use a larger preregistered sample.`);
}
const paths = (await readdir('examples/judge-benchmarks/src'))
  .filter((file) => /\.(ts|py)$/.test(file))
  .map((file) => join('examples/judge-benchmarks/src', file));
paths.push(join(folder, 'label-audit.json'), join(folder, 'test-label-audit.json'));
const hashes: Record<string, string> = {};
for (const path of paths)
  hashes[path] = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const plan = {
  contestant: id,
  at: new Date().toISOString(),
  hashes,
  seed: TEST_SEED,
  sampleIds: sample.map((item) => item.id),
  population: population.length,
  populationHash: createHash('sha256').update(JSON.stringify(population)).digest('hex'),
  sampling: 'Proportional official-label by response-length (10000 characters) strata, fixed seeded hash.',
  dev: {
    official: c.summary,
    auditedAccuracy: right / 95,
    auditedCorrect: right,
    costPer100Usd: (c.costUsd * 100) / 95,
  },
  criterion: benchmark.criterion,
  auditPolicy: `${audit.length} DEV changes and 23 TEST changes; TEST unresolved labels remain official. No audit ids or labels enter judging.`,
};
await writeFile(join(folder, 'freeze-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
console.log(
  JSON.stringify({
    contestant: id,
    devOfficial: c.summary.value.estimate,
    devAudited: right / 95,
    costPer100Usd: plan.dev.costPer100Usd,
    testSize: sample.length,
  }),
);
if (process.env.VERIFY_SPEND_LEDGER)
  await appendFile(
    process.env.VERIFY_SPEND_LEDGER,
    `| ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })} | codex/verify-judge ${id}: strict frozen DEV replay, 95 items; TEST sample preregistered ${sample.length}/${population.length} | haiku replay | 0 | 8 task cap | 0.0000000 | commit SHA follows |\n`,
  );
