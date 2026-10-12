import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { priorMMSpend } from './mm-budget';

async function main() {
  const root = 'examples/judge-benchmarks/experiments/mm-results';
  const selected = JSON.parse(await readFile(`${root}/freeze-selection.json`, 'utf8')).selected;
  const config = JSON.parse(await readFile(`${root}/frozen-config.json`, 'utf8'));
  const dev = JSON.parse(await readFile(`${root}/${config.devTag}.json`, 'utf8'));
  const spend = await priorMMSpend('examples/judge-benchmarks/recordings/mmeval/haiku.jsonl', root);
  const cutoff = Date.parse('2026-10-13T06:30:00+02:00');
  const remainingSeconds = (cutoff - Date.now()) / 1000;
  const callsPerItem = selected.callsPerItem;
  const measuredSeconds = Math.max(1, dev.meanCallSeconds);
  // Explicit forecast margins reserve thirty minutes plus 35% latency and 25% cost headroom.
  const timeBound = Math.floor(
    (Math.max(0, remainingSeconds - 1800) * 3) / (callsPerItem * measuredSeconds * 1.35),
  );
  const budgetBound = Math.floor(Math.max(0, 7.4 - spend.total) / ((selected.costPer100 / 100) * 1.25));
  const n = Math.floor(Math.min(3529, timeBound, budgetBound) / 25) * 25;
  if (n < 100) throw new Error('Insufficient time or budget for the planned test sample');
  const report = {
    label: 'test sample plan',
    items: n,
    cutoff: '2026-10-13T06:30:00+02:00',
    frozenAt: config.frozenAt,
    remainingSeconds,
    priorSpend: spend,
    callsPerItem,
    measuredSecondsPerCall: measuredSeconds,
    concurrency: 3,
    timeBound,
    budgetBound,
    latencyMargin: 1.35,
    costMargin: 1.25,
    reserveSeconds: 1800,
    estimatedCalls: n * callsPerItem,
    estimatedNewSpendUsd: (n * selected.costPer100) / 100,
    estimatedSeconds: (n * callsPerItem * measuredSeconds) / 3,
    seed: 'mm-frozen-test-sample-v1',
    time: new Date().toISOString(),
  };
  await writeFile(`${root}/test-sample-plan.json`, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report) + '\n');
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
