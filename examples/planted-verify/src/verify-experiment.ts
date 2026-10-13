import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { contestantById } from './contestants';
import { renderReport, runBenchmark } from './run';

// This driver meters all appended recordings, including the interrupted earlier run.
// It only selects dev items. Labels never enter contestant prompts or routing.
const recording = 'examples/judge-benchmarks/recordings/longjudge-verify/haiku.jsonl';
const baselineLines = execFileSync('git', ['show', `0fa48a41:${recording}`], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .trimEnd()
  .split('\n').length;
const folder = 'examples/judge-benchmarks/results/verify-dev';
await mkdir(folder, { recursive: true });
const spent = async () =>
  (await readFile(recording, 'utf8'))
    .trimEnd()
    .split('\n')
    .slice(baselineLines)
    .reduce((sum, line) => sum + Number(JSON.parse(line).costUsd ?? 0), 0);
const ledger = process.env.VERIFY_SPEND_LEDGER;
const deadlineAt = Date.parse(process.env.VERIFY_DEADLINE ?? '');
if (!Number.isFinite(deadlineAt))
  throw new Error('Set VERIFY_DEADLINE to the task deadline with its timezone.');
const ids = process.argv.slice(2);
if (!ids.length) throw new Error('Pass one or more registered contestant ids.');
for (const id of ids) {
  const before = await spent();
  const startedAt = Date.now();
  if (before >= 7.97) break;
  const report = await runBenchmark({
    bench: 'longjudge-verify',
    model: 'haiku',
    contestants: [contestantById(id)],
    split: 'dev',
    concurrency: 1,
    capUsd: 7.97 - before,
    includeDecisions: true,
    deadlineAt,
  });
  await writeFile(
    join(folder, `${id}.json`),
    `${JSON.stringify({ ...report, timing: { startedAt: new Date(startedAt).toISOString(), endedAt: new Date().toISOString(), elapsedSeconds: (Date.now() - startedAt) / 1000 } }, null, 2)}\n`,
  );
  process.stdout.write(`${renderReport(report)}\n`);
  const after = await spent();
  if (ledger) {
    const time = new Date().toLocaleTimeString('en-GB', {
      timeZone: 'Europe/Brussels',
      hour: '2-digit',
      minute: '2-digit',
    });
    const result = report.contestants[0];
    await appendFile(
      ledger,
      `| ${time} | codex/verify-judge ${id}: DEV only, ${report.items} items, accuracy ${(100 * (result?.summary.value.estimate ?? 0)).toFixed(1)}, balanced ${(100 * (result?.summary.balancedAccuracy ?? 0)).toFixed(1)}${report.stopped ? ', partial' : ''} | haiku | ${report.newCalls} | ${(7.97 - before).toFixed(4)} remaining cap | ${report.newSpendUsd.toFixed(7)} | verify task ${after.toFixed(7)} of 8 |\n`,
    );
  }
  if (report.stopped) break;
}
