/** Sequential DEV experiments. Run after the contrast recording job has finished. */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { contestantById } from './contestants';
import { type RunReport, renderReport, runBenchmark } from './run';

const out = 'examples/judge-benchmarks/jb-results';
const ledger = process.env.JB_SPEND_LEDGER;
if (!ledger) throw new Error('JB_SPEND_LEDGER must name the append-only spend ledger');
const ids = process.argv.slice(2);
const startingKeys = new Set<string>(JSON.parse(await readFile(`${out}/starting-keys.json`, 'utf8')));
const totalSpent = async () =>
  (await readFile('examples/judge-benchmarks/recordings/judgebench/haiku.jsonl', 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { key: string; costUsd: number })
    .filter((row) => !startingKeys.has(row.key))
    .reduce((sum, row) => sum + row.costUsd, 0);
let total = await totalSpent();
let contrast: RunReport | undefined;
while (!contrast) {
  try {
    contrast = JSON.parse(await readFile(`${out}/contrast.json`, 'utf8'));
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
total = await totalSpent();
const contrastResult = contrast.contestants[0];
if (!contrastResult) throw new Error('contrast run has no contestant result');
const time = () =>
  new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
await appendFile(
  ledger,
  `| ${time()} | codex-jb contrast resume finished: ${contrastResult.summary.value.estimate * 100} percent official dev | haiku | ${contrast.newCalls} | resume cap | ${contrast.newSpendUsd.toFixed(8)} | codex-jb total ${total.toFixed(8)} of 8.00 |\n`,
);
for (const id of ids) {
  try {
    const prior = JSON.parse(await readFile(`${out}/${id}.json`, 'utf8'));
    if (!prior.stopped && prior.contestants[0].summary.missing === 0) {
      if (prior.contestants[0].summary.value.estimate >= 0.95) break;
      continue;
    }
  } catch {
    /* No completed run to replay. */
  }

  // Keep a reserve for interrupted calls whose returned prices were lost on restart.
  const remaining = 7.9 - total;
  if (remaining < 0.02) break;
  await appendFile(
    ledger,
    `| ${time()} | codex-jb ${id} full dev before: both orders, concurrency 1 | haiku | pending | ${remaining.toFixed(4)} cap | pending | codex-jb total ${total.toFixed(8)} of 8.00 |\n`,
  );
  const report = await runBenchmark({
    bench: 'judgebench',
    model: 'haiku',
    split: 'dev',
    contestants: [contestantById(id)],
    capUsd: remaining,
    concurrency: 1,
  });
  total = await totalSpent();
  await writeFile(`${out}/${id}.json`, JSON.stringify(report, null, 2));
  await writeFile(`${out}/${id}.txt`, renderReport(report));
  await writeFile(`${out}/spend.json`, JSON.stringify({ total, reserve: 0.1, completed: id }));
  const result = report.contestants[0];
  console.log(renderReport(report));
  await appendFile(
    ledger,
    `| ${time()} | codex-jb ${id} after: ${result?.summary.value.estimate ? (100 * result.summary.value.estimate).toFixed(1) : '0'} percent official dev, missing ${result?.summary.missing ?? 'unknown'} | haiku | ${report.newCalls} | ${remaining.toFixed(4)} cap | ${report.newSpendUsd.toFixed(8)} | codex-jb total ${total.toFixed(8)} of 8.00 |\n`,
  );
  if (report.stopped) break;
  if (result && result.summary.missing === 0 && result.summary.value.estimate >= 0.95) break;
}
