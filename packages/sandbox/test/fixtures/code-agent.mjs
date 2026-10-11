#!/usr/bin/env node
/**
 * A fixture code agent for the sandbox and process adapter tests. It reads its instruction from stdin, or
 * from the file named by its first argument, and works in its current folder, the workspace:
 *
 * - it turns catalog.csv into out/acme-price-sheet.csv, a deterministic artifact with a yearly price;
 * - an instruction that asks for a summary adds the cheapest plan of each category to that file;
 * - "delete README.txt" deletes README.txt, the destructive case;
 * - "sleep <ms>" waits that long first, "exit <code>" exits with that code, "garble" writes a bad
 *   protocol line;
 * - it runs one real command and reports it on driftbench-commands.jsonl, and reports a skill, a guard
 *   and a stage on driftbench-runtime.jsonl.
 *
 * It touches no other file. Fictional data only.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const instruction = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : readFileSync(0, 'utf8');
const commandsFile = process.env.DRIFTBENCH_COMMANDS_FILE ?? 'driftbench-commands.jsonl';
const runtimeFile = process.env.DRIFTBENCH_RUNTIME_FILE ?? 'driftbench-runtime.jsonl';
const historyFile = process.env.DRIFTBENCH_HISTORY_FILE ?? 'driftbench-history.json';

const sleep = /sleep (\d+)/.exec(instruction);
if (sleep) await new Promise((resolve) => setTimeout(resolve, Number(sleep[1])));

const history = existsSync(historyFile) ? JSON.parse(readFileSync(historyFile, 'utf8')) : [];
const catalog = existsSync('catalog.csv') ? readFileSync('catalog.csv', 'utf8') : 'plan_id,name,category\n';
const plans = catalog
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => line.split(','))
  .map((cells) => ({ id: cells[0], name: cells[1], category: cells[2], monthly: Number(cells[4]) }));

const lines = ['plan_id,name,category,monthly_usd,yearly_usd'];
for (const plan of plans)
  lines.push(`${plan.id},${plan.name},${plan.category},${plan.monthly},${plan.monthly * 12}`);
const summary = /summary/i.test(instruction);
if (summary) {
  for (const category of [...new Set(plans.map((plan) => plan.category))]) {
    const cheapest = plans
      .filter((plan) => plan.category === category)
      .reduce((best, plan) => (plan.monthly < best.monthly ? plan : best));
    lines.push(`summary,${cheapest.name},${category},${cheapest.monthly},${cheapest.monthly * 12}`);
  }
}
mkdirSync('out', { recursive: true });
writeFileSync('out/acme-price-sheet.csv', `${lines.join('\n')}\n`);

const destructive = /delete README\.txt/.test(instruction);
if (destructive) rmSync('README.txt', { force: true });

const startedAt = new Date().toISOString();
const started = performance.now();
const ran = spawnSync(process.execPath, ['--version'], { encoding: 'utf8' });
const record = {
  command: 'node --version',
  exitCode: ran.status ?? 1,
  startedAt,
  latencyMs: Math.round(performance.now() - started),
};
appendFileSync(commandsFile, `${JSON.stringify(record)}\n`);
if (/garble/.test(instruction)) appendFileSync(commandsFile, 'this line is not json\n');

const events = [
  { type: 'skill', name: 'csv' },
  { type: 'guard', name: 'no_destructive_ops', verdict: destructive ? 'fail' : 'pass' },
  { type: 'stage', name: summary ? 'add_summary' : 'build_sheet' },
];
appendFileSync(runtimeFile, events.map((event) => `${JSON.stringify(event)}\n`).join(''));

const parts = [`Wrote out/acme-price-sheet.csv with ${plans.length} plans.`];
if (summary) parts.push('Added a summary of the cheapest plans.');
if (destructive) parts.push('Deleted README.txt.');
parts.push(`History: ${history.length} ${history.length === 1 ? 'message' : 'messages'}.`);
process.stdout.write(`${parts.join(' ')}\n`);

const exit = /exit (\d+)/.exec(instruction);
if (exit) process.exitCode = Number(exit[1]);
