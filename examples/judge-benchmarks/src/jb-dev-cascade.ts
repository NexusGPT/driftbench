/** Complete the uncertainty-selected dev experiment before attempting extra controls. */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { runReferenceCascade } from './cascade-run';
import { contestantById } from './contestants';
import { runBenchmark } from './run';
import type { PairResult } from './score';

const out = 'examples/judge-benchmarks/jb-results',
  ledger = process.env.JB_SPEND_LEDGER;
if (!ledger) throw new Error('JB_SPEND_LEDGER required');
const initial = new Set<string>(JSON.parse(await readFile(`${out}/starting-keys.json`, 'utf8')));
const spent = async () =>
  (await readFile('examples/judge-benchmarks/recordings/judgebench/haiku.jsonl', 'utf8'))
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { key: string; costUsd: number })
    .filter((r) => !initial.has(r.key))
    .reduce((n, r) => n + r.costUsd, 0);
for (const id of process.argv.slice(2)) {
  const cap = 7.8 - (await spent()),
    results: PairResult[] = [];
  const stamp = () =>
    new Date().toLocaleTimeString('en-GB', {
      timeZone: 'Europe/Brussels',
      hour: '2-digit',
      minute: '2-digit',
    });
  await appendFile(
    ledger,
    `| ${stamp()} | codex-jb ${id} DEV before | haiku | pending | ${cap.toFixed(4)} cap | pending | concurrency 1, dev only |\n`,
  );
  const signals = `${out}/${id}-signals.jsonl`;
  await writeFile(signals, '');
  const options = {
    bench: 'judgebench',
    split: 'dev',
    model: 'haiku',
    concurrency: 1,
    capUsd: cap,
    maxCallUsd: 0.04,
    deadlineMs: Date.parse('2026-10-13T04:20:00+02:00'),
    replayOnly: process.env.JB_REPLAY_ONLY === '1' ? true : undefined,
    onPairResult: (r: PairResult) => {
      results.push(r);
    },
    onEvidence: async (s: unknown) => {
      await appendFile(signals, `${JSON.stringify(s)}\n`);
    },
  } as const;
  const report = id.endsWith('-cascade')
    ? await runReferenceCascade({ ...options, escalation: contestantById(id.replace(/-cascade$/, '')) })
    : await runBenchmark({ ...options, contestants: [contestantById(id)] });
  await writeFile(`${out}/${id}.json`, JSON.stringify(report, null, 2));
  await writeFile(`${out}/${id}-decisions.json`, JSON.stringify(results, null, 2));
  await appendFile(
    ledger,
    `| ${stamp()} | codex-jb ${id} DEV after: ${(100 * (report.contestants[0]?.summary.value.estimate ?? 0)).toFixed(1)} percent; missing ${report.contestants[0]?.summary.missing} | haiku | ${report.newCalls} | ${cap.toFixed(4)} cap | ${report.newSpendUsd.toFixed(8)} | total ${(await spent()).toFixed(8)} of 8.00 |\n`,
  );
  console.log(JSON.stringify(report));
  if (report.stopped) break;
}
