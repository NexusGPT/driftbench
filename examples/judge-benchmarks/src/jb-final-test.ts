/** One frozen held-out run, authorized by the lead after dev tuning. Never use this output to tune. */
import { execFileSync } from 'node:child_process';
import { appendFile, open, readFile, writeFile } from 'node:fs/promises';
import { runReferenceCascade } from './cascade-run';
import { contestantById } from './contestants';
import { loadBenchmark, type PairItem, splitOf, stratifiedSample } from './data';
import { designHashes } from './jb-freeze';
import { type RunReport, renderReport, runBenchmark } from './run';
import type { PairResult } from './score';

const out = 'examples/judge-benchmarks/jb-results';
const freeze = JSON.parse(await readFile(`${out}/freeze.json`, 'utf8')) as {
  sha: string;
  ids: string[];
  sample: number;
  seed: string;
  confidenceThreshold: number;
  deadlineMs: number;
  hashes: Record<string, string>;
};
const ids = freeze.ids;
if (ids.length !== 2) throw new Error('Freeze must name the two format-ablation configurations.');
if (Date.now() >= freeze.deadlineMs) throw new Error('The held-out deadline has passed.');
const hashes = await designHashes();
if (JSON.stringify(hashes) !== JSON.stringify(freeze.hashes)) throw new Error('Design changed after freeze.');
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
const marker = await open(`${out}/final-test-start.json`, 'wx');
await marker.writeFile(
  JSON.stringify(
    {
      stamp: new Date().toISOString(),
      ids,
      freeze,
      sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      hashes,
    },
    null,
    2,
  ),
);
await marker.close();
const benchmark = await loadBenchmark('judgebench');
const population = benchmark.items.filter((i) => splitOf('judgebench', i.id) === 'test') as PairItem[];
const items = freeze.sample ? stratifiedSample(population, freeze.sample, freeze.seed) : population;
await writeFile(
  `${out}/final-test-blind-audit.json`,
  JSON.stringify(
    items.map(({ id, question, a, b, group }) => ({ id, question, a, b, group })),
    null,
    2,
  ),
);
await writeFile(
  `${out}/final-test-sample.json`,
  JSON.stringify(
    {
      population: population.length,
      n: items.length,
      seed: freeze.seed,
      ids: items.map((i) => i.id),
      groups: Object.fromEntries(
        [...new Set(population.map((i) => i.group))].map((g) => [
          g,
          {
            population: population.filter((i) => i.group === g).length,
            sample: items.filter((i) => i.group === g).length,
          },
        ]),
      ),
    },
    null,
    2,
  ),
);
const cap = 7.8 - (await spent());
if (cap <= 0.05) throw new Error('No remaining task budget for the held-out run.');
const time = () =>
  new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
await appendFile(
  ledger,
  `| ${time()} | codex-jb final frozen TEST before: ${ids.join(', ')}; one run, both orders, concurrency 1 | haiku | pending | ${cap.toFixed(4)} cap | pending | no tuning after this run |\n`,
);
const signals = `${out}/final-test-signals.jsonl`;
await writeFile(signals, '');
const common = {
  bench: 'judgebench',
  split: 'test',
  items,
  criterion: benchmark.criterion,
  model: 'haiku',
  concurrency: 1,
  capUsd: cap,
  maxCallUsd: 0.04,
  deadlineMs: freeze.deadlineMs,
  onEvidence: async (s: { item: string; kind: string; status: string; details?: unknown }) => {
    await appendFile(signals, `${JSON.stringify(s)}\n`);
  },
} as const;
let report: RunReport;
const decisions: Record<string, PairResult[]> = {};
const stage = async (id: string, remaining: number) => {
  const results: PairResult[] = [];
  const options = {
    ...common,
    capUsd: remaining,
    onPairResult: (r: PairResult) => {
      results.push(r);
    },
  };
  const r = id.endsWith('-cascade')
    ? await runReferenceCascade({
        ...options,
        escalation: contestantById(id.replace(/-cascade$/, '')),
        confidenceThreshold: freeze.confidenceThreshold,
      })
    : await runBenchmark({ ...options, contestants: [contestantById(id)] });
  decisions[id] = results;
  await writeFile(`${out}/final-test-decisions.json`, JSON.stringify(decisions, null, 2));
  await writeFile(`${out}/final-test-${id}.json`, JSON.stringify(r, null, 2));
  return r;
};
{
  const parts: RunReport[] = [];
  for (const id of ids) {
    const remaining = 7.8 - (await spent());
    parts.push(await stage(id, remaining));
    if (parts.at(-1)?.stopped) break;
  }
  const first = parts[0];
  if (!first) throw new Error('No test stage ran.');
  report = {
    ...first,
    contestants: parts.flatMap((p) => p.contestants),
    newCalls: parts.reduce((n, p) => n + p.newCalls, 0),
    newSpendUsd: parts.reduce((n, p) => n + p.newSpendUsd, 0),
    replayed: parts.reduce((n, p) => n + p.replayed, 0),
    failedCalls: parts.reduce((n, p) => n + p.failedCalls, 0),
    ...(parts.find((p) => p.stopped)?.stopped ? { stopped: parts.find((p) => p.stopped)?.stopped } : {}),
  };
}
await writeFile(`${out}/final-test.json`, JSON.stringify(report, null, 2));
await writeFile(`${out}/final-test.txt`, renderReport(report));
await appendFile(
  ledger,
  `| ${time()} | codex-jb final frozen TEST after: ${report.contestants.map((c) => `${c.contestant} ${(c.summary.value.estimate * 100).toFixed(1)} percent, missing ${c.summary.missing}`).join('; ')} | haiku | ${report.newCalls} | ${cap.toFixed(4)} cap | ${report.newSpendUsd.toFixed(8)} | total ${(await spent()).toFixed(8)} of 8.00 |\n`,
);
console.log(renderReport(report));
