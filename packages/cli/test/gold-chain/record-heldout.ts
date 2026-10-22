/**
 * Records the per-atom limit requests of a units-table estate once, and scores them. Run it by hand, never in CI:
 *
 *   GOLD_ASK_CAP_IN=400000 GOLD_ASK_CAP_OUT=100000 pnpm exec tsx packages/cli/test/gold-chain/record-heldout.ts examples/estates/heldout-1
 *   GOLD_ASK_DRY=1 pnpm exec tsx packages/cli/test/gold-chain/record-heldout.ts examples/estates/heldout-1   (no key, no call: counts the requests)
 *
 * The answers go to <folder>/limits.ask.<model>.jsonl and the run replays them with no call when they are there. The
 * key is read from ~/.nexus-secrets/anthropic-driftbench.key, kept in memory and never printed. The cost is the tokens
 * the answers report times the price of docs/estate-pointer-reader.md section 11 (USD 0.10 per million input, 0.50
 * per million output). The producer, its prompts and the scan are those of the gold chain; nothing is special to the estate.
 */
import { join, resolve } from 'node:path';
import { runUnitsEstate } from './heldout';
import { loadUnitsEstate } from './units-estate';
import { ASK_MODEL, askPortFor, loadAsksFrom, readKey } from './limits-ask';

const folder = resolve(process.argv[2] ?? '');
if (process.argv[2] === undefined) throw new Error('name the estate folder, e.g. examples/estates/heldout-1');
const capIn = Number(process.env.GOLD_ASK_CAP_IN ?? Number.POSITIVE_INFINITY);
const capOut = Number(process.env.GOLD_ASK_CAP_OUT ?? Number.POSITIVE_INFINITY);
const path = join(folder, `limits.ask.${ASK_MODEL}.jsonl`);
const cache = loadAsksFrom(path);
const spent = { input: 0, output: 0, requests: 0 };
const dry = process.env.GOLD_ASK_DRY !== undefined && process.env.GOLD_ASK_DRY !== '';

const ask = dry
  ? async () => '{"limits": []}'
  : askPortFor(path, folder, ASK_MODEL, cache, spent, { key: readKey(), capIn, capOut });
const run = await runUnitsEstate({ folder, ask });
const cost = spent.input * (0.1 / 1_000_000) + spent.output * (0.5 / 1_000_000);
console.log(
  `${folder}: ${run.requests} requests, ${spent.requests} sent, ${spent.input} tokens in, ${spent.output} out, USD ${cost.toFixed(4)}`,
);
console.log(`units of the table not cut as the table does: ${run.unmatched.length}`);
const table = new Map((await loadUnitsEstate(folder)).truth.units.map((unit) => [unit.id, unit.text]));
const kindOf = (text: string): string =>
  text.startsWith('|') ? 'table row' : text.startsWith('**') ? 'bold line' : 'other';
for (const id of run.unmatched) {
  const text = table.get(id) ?? '';
  console.log(`  unmatched ${id} [${kindOf(text)}] ${text.slice(0, 60)}`);
}
console.log(`units of the scan that the table does not list: ${run.outside.length}`);
for (const line of run.outside) console.log(`  outside ${line}`);
if (!dry) {
  const { score } = run;
  console.log(
    `limits found by number on the governed unit: ${score.limits.found} of ${score.limits.truth} (recall ${score.recall.toFixed(2)})`,
  );
  console.log(
    `limits exact (also the comparison and the role as written; understates, there is no normal form): ${score.limits.exact} of ${score.limits.truth} (${score.exactRecall.toFixed(2)})`,
  );
  console.log(
    `produced ${score.produced.total}: ${score.produced.matched} matched (precision ${score.precision.toFixed(2)}), ${score.produced.nonLimitHits} on non-limits, ${score.produced.otherExtras} elsewhere; ${run.unreadable} unreadable answers`,
  );
  console.log(`non-limits hit: ${score.nonLimits.hit.length} of ${score.nonLimits.truth}`);
  console.log(`limits missing: ${score.limits.missing.join(', ')}`);
  console.log(
    `limits unreachable by construction (the governed unit got no request): ${score.limits.unreachable.length}${score.limits.unreachable.length > 0 ? ` (${score.limits.unreachable.join(', ')})` : ''}`,
  );
}
