// Reads the condition spans the failing bank items need, for the span labeller (tools/variables-label-spans.mjs).
//
//   pnpm exec tsx tools/variables-failing-spans.ts <variables-items.json> <out dir>
//
// The input is the report `driftbench validate variables --items --all-levels --json` prints. Each item that failed on
// a seed is run again on that seed, alone, and every condition span it reads is written to `<out>/spans.jsonl` (one
// distinct text per line). With DRIFTBENCH_VARIABLES_CASSETTE set, the run replays the labels already recorded, so an
// item that stopped at its first unlabelled span now reaches the next one: the labeller records the new spans and this
// is run again, until a run reads no span the cassette lacks. The scale items stay out: their spans number in the
// thousands and are not labelled.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { variablesImpl } from '../packages/validators/src/ladders/variables/adapter';
import { runItem, variablesBank } from '../packages/validators/src/ladders/variables/bank/index';

const [reportFile, outDir] = process.argv.slice(2);
if (reportFile === undefined || outDir === undefined) {
  console.error('usage: tsx tools/variables-failing-spans.ts <variables-items.json> <out dir>');
  process.exit(2);
}

type Report = {
  seeds: Array<{ seed: number }>;
  bank: { rows: Array<{ id: string; perSeed: string[] }> };
};
const report = JSON.parse(readFileSync(reportFile, 'utf8')) as Report;
const root = fileURLToPath(new URL('../', import.meta.url));
const bank = new Map(variablesBank().map((item) => [item.id, item]));
const SCALE = /^(blind\.)?scale\./;

mkdirSync(outDir, { recursive: true });
const raw = join(outDir, 'raw.jsonl');
rmSync(raw, { force: true });
writeFileSync(raw, '');
process.env.DRIFTBENCH_VARIABLES_SPANS_OUT = raw;

const failing: Array<{ seed: number; id: string }> = [];
report.seeds.forEach(({ seed }, at) => {
  for (const row of report.bank.rows) {
    if (row.perSeed[at] === 'fail' && !SCALE.test(row.id)) failing.push({ seed, id: row.id });
  }
});
for (const { seed, id } of failing) {
  const item = bank.get(id);
  if (item === undefined) throw new Error(`the report names an item the bank lacks: ${id}`);
  await runItem(item, seed, root, variablesImpl);
}

const texts = new Set<string>();
for (const line of readFileSync(raw, 'utf8').split('\n')) {
  if (line !== '') texts.add((JSON.parse(line) as { text: string }).text);
}
const sorted = [...texts].sort();
writeFileSync(join(outDir, 'spans.jsonl'), sorted.map((text) => `${JSON.stringify({ text })}\n`).join(''));
rmSync(raw);
console.log(`failing items run ${failing.length}, distinct spans ${sorted.length}`);
