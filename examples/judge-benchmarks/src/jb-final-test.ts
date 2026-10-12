/** One frozen held-out run, authorized by the lead after dev tuning. Never use this output to tune. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, open, readFile, writeFile } from 'node:fs/promises';
import { contestantById } from './contestants';
import { renderReport, runBenchmark } from './run';

const out = 'examples/judge-benchmarks/jb-results';
const ids = process.argv.slice(2);
if (ids.length !== 2)
  throw new Error('Provide exactly the frozen configuration without and with format parsing.');
const ledger = process.env.JB_SPEND_LEDGER;
if (!ledger) throw new Error('JB_SPEND_LEDGER is required');
const initial = new Set<string>(JSON.parse(await readFile(`${out}/starting-keys.json`, 'utf8')));
const spent = async () =>
  (await readFile('examples/judge-benchmarks/recordings/judgebench/haiku.jsonl', 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { key: string; costUsd: number })
    .filter((r) => !initial.has(r.key))
    .reduce((sum, r) => sum + r.costUsd, 0);
const sources = ['src/contestants.ts', 'src/run.ts', 'src/extras.ts', 'src/call.ts'];
const hashes = Object.fromEntries(
  await Promise.all(
    sources.map(async (p) => [
      p,
      createHash('sha256')
        .update(await readFile(`examples/judge-benchmarks/${p}`))
        .digest('hex'),
    ]),
  ),
);
const marker = await open(`${out}/final-test-start.json`, 'wx');
await marker.writeFile(
  JSON.stringify(
    {
      stamp: new Date().toISOString(),
      ids,
      sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      hashes,
    },
    null,
    2,
  ),
);
await marker.close();
const cap = 7.85 - (await spent());
if (cap <= 0.05) throw new Error('No remaining task budget for the held-out run.');
const time = () =>
  new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
await appendFile(
  ledger,
  `| ${time()} | codex-jb final frozen TEST before: ${ids.join(', ')}; one run, both orders, concurrency 1 | haiku | pending | ${cap.toFixed(4)} cap | pending | no tuning after this run |\n`,
);
const signals = `${out}/final-test-signals.jsonl`;
await writeFile(signals, '');
const report = await runBenchmark({
  bench: 'judgebench',
  split: 'test',
  model: 'haiku',
  contestants: ids.map(contestantById),
  concurrency: 1,
  capUsd: cap,
  maxCallUsd: 0.04,
  deadlineMs: Date.parse('2026-10-13T07:00:00+02:00'),
  onEvidence: async (s) => {
    await appendFile(signals, `${JSON.stringify(s)}\n`);
  },
});
await writeFile(`${out}/final-test.json`, JSON.stringify(report, null, 2));
await writeFile(`${out}/final-test.txt`, renderReport(report));
await appendFile(
  ledger,
  `| ${time()} | codex-jb final frozen TEST after: ${report.contestants.map((c) => `${c.contestant} ${(c.summary.value.estimate * 100).toFixed(1)} percent, missing ${c.summary.missing}`).join('; ')} | haiku | ${report.newCalls} | ${cap.toFixed(4)} cap | ${report.newSpendUsd.toFixed(8)} | total ${(await spent()).toFixed(8)} of 8.00 |\n`,
);
console.log(renderReport(report));
