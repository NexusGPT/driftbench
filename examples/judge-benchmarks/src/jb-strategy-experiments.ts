/** DEV only, sequential real calls, with a persistent budget and the task's local deadline. */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { contestantById } from './contestants';
import { type RunReport, renderReport, runBenchmark } from './run';

const out = 'examples/judge-benchmarks/jb-results';
const sample = process.env.JB_SAMPLE ? Number(process.env.JB_SAMPLE) : undefined;
const ledger = process.env.JB_SPEND_LEDGER;
if (!ledger) throw new Error('JB_SPEND_LEDGER is required');
const initial = new Set<string>(JSON.parse(await readFile(`${out}/starting-keys.json`, 'utf8')));
const spent = async () =>
  (await readFile('examples/judge-benchmarks/recordings/judgebench/haiku.jsonl', 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { key: string; costUsd: number })
    .filter((row) => !initial.has(row.key))
    .reduce((n, row) => n + row.costUsd, 0);
const time = () =>
  new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
let direct: RunReport | undefined;
while (!direct) {
  try {
    direct = JSON.parse(await readFile(`${out}/direct-baselines.json`, 'utf8')) as RunReport;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
let total = await spent();
await appendFile(
  ledger,
  `| ${time()} | codex-jb direct baselines after: ${direct.contestants.map((c) => `${c.contestant} ${(c.summary.value.estimate * 100).toFixed(1)}`).join('; ')} percent dev | haiku | ${direct.newCalls} | 1.00 cap | ${direct.newSpendUsd.toFixed(8)} | codex-jb total ${total.toFixed(8)} of 8.00 |\n`,
);
for (const id of process.argv.slice(2)) {
  const remaining = 7.85 - total;
  if (remaining < 0.05) break;
  if (Date.now() >= Date.parse('2026-10-13T07:00:00+02:00')) break;
  const c = contestantById(id);
  const stem = `${id}${sample ? '-pilot' : ''}`;
  const signals = `${out}/${stem}-signals.jsonl`;
  await writeFile(signals, '');
  await appendFile(
    ledger,
    `| ${time()} | codex-jb ${id} before: DEV only, both orders, concurrency 1 | haiku | pending | ${remaining.toFixed(4)} cap | pending | codex-jb total ${total.toFixed(8)} of 8.00 |\n`,
  );
  const r = await runBenchmark({
    bench: 'judgebench',
    split: 'dev',
    model: 'haiku',
    contestants: [c],
    concurrency: 1,
    capUsd: remaining,
    maxCallUsd: 0.04,
    deadlineMs: Date.parse('2026-10-13T07:00:00+02:00'),
    ...(sample ? { sample } : {}),
    onEvidence: async (signal) => {
      await appendFile(signals, `${JSON.stringify(signal)}\n`);
    },
  });
  total = await spent();
  await writeFile(`${out}/${stem}.json`, JSON.stringify(r, null, 2));
  await writeFile(`${out}/${stem}.txt`, renderReport(r));
  await writeFile(`${out}/spend.json`, JSON.stringify({ total, reserve: 0.15, completed: id }));
  console.log(renderReport(r));
  const result = r.contestants[0];
  await appendFile(
    ledger,
    `| ${time()} | codex-jb ${id} after: ${result ? (100 * result.summary.value.estimate).toFixed(1) : 'unknown'} percent official dev; missing ${result?.summary.missing ?? 'unknown'} | haiku | ${r.newCalls} | ${remaining.toFixed(4)} cap | ${r.newSpendUsd.toFixed(8)} | codex-jb total ${total.toFixed(8)} of 8.00 |\n`,
  );
  if (r.stopped) break;
  if (
    !sample &&
    result &&
    result.summary.missing === 0 &&
    result.summary.value.estimate >= 0.95 &&
    (id.endsWith('-format') || id.endsWith('-format-ledger'))
  )
    break;
}
