import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contestantById } from './contestants';
import { renderReport, runBenchmark } from './run';

/** Run one dev-only experiment and append its actual spend to the authorized ledger. */
async function main(): Promise<void> {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const name = arg('name');
  const cap = Number(arg('cap-usd'));
  const ledger = arg('ledger');
  if (!name || !Number.isFinite(cap) || cap < 0 || !ledger)
    throw new Error('--name, --cap-usd and --ledger required');
  const ids = (
    arg('contestants') ??
    'driftbench-rb-binary,driftbench-rb-equal,driftbench-rb-weighted,driftbench-rb-holistic'
  ).split(',');
  const report = await runBenchmark({
    bench: 'rubricbench',
    model: 'haiku',
    split: 'dev',
    concurrency: 1,
    capUsd: cap,
    deadlineMs: new Date('2026-10-13T07:00:00+02:00').getTime(),
    onProgress: ({ calls, spentUsd, item }) => {
      if (calls > 0 && calls % 10 === 0)
        process.stdout.write(`calls=${calls} spend=${spentUsd.toFixed(4)} item=${item}\n`);
    },
    contestants: ids.map(contestantById),
    ...(arg('sample') ? { sample: Number(arg('sample')) } : {}),
    ...(arg('seed') ? { seed: arg('seed') } : {}),
    replayOnly: process.argv.includes('--replay-only') ? 'lenient' : false,
  });
  const directory = join(fileURLToPath(new URL('..', import.meta.url)), 'experiments', 'rb');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  const time = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Brussels',
    hour: '2-digit',
    minute: '2-digit',
  });
  await appendFile(
    ledger,
    `| ${time} | codex/rb-judge ${name}: dev only, ${report.items} items, ${ids.join(', ')}${report.stopped ? ', partial' : ''} | haiku | ${report.newCalls} | ${cap.toFixed(4)} | ${report.newSpendUsd.toFixed(6)} | rb task +${report.newSpendUsd.toFixed(6)} of 8.00 |\n`,
  );
  process.stdout.write(`${renderReport(report)}\n`);
  if (report.stopped) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 2;
});
