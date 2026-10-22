/**
 * Records the limits of the gold estates with a model, once. Run it by hand, never in CI:
 *
 *   pnpm exec tsx packages/cli/test/gold-chain/record-limits.ts A B C
 *
 * The key is read from ~/.nexus-secrets/anthropic-driftbench.key, kept in memory and never printed. The cassette of an
 * estate (examples/estates/gold-<x>/limits.cassette.jsonl) holds the answers of the limits set only; the chain
 * replays them. The gold labels stay planted, so the requests of the gold set are not recorded. The report gives the
 * tokens each estate cost and the price they come to (USD 0.10 per million input tokens, 0.50 per million output, the
 * price of docs/estate-pointer-reader.md section 11).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pointer, readerFor, scanEstate } from '@agent-nexus/driftbench-estate';
import {
  ESTATE_NAMES,
  type EstateName,
  estateFiles,
  GOLD_ESTATE_KEY,
  goldLabeller,
  loadGold,
} from '../../../estate/test/gold/gold';
import { LAYOUT } from './layout';
import {
  cassettePath,
  chainSets,
  composite,
  DEFAULT_LIMITS_MODEL,
  LIMITS_RUNS,
  LIMITS_SET_NAME,
} from './limits';

const PRICE_IN = 0.1 / 1_000_000;
const PRICE_OUT = 0.5 / 1_000_000;

async function record(
  estate: EstateName,
  key: string,
  modelName: string,
): Promise<{ input: number; output: number; requests: number }> {
  const dir = await mkdtemp(join(tmpdir(), `record-limits-${estate}-`));
  try {
    for (const file of await estateFiles(estate)) {
      const target = join(dir, LAYOUT[estate][file.path] ?? '');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.text);
    }
    const gold = (await loadGold()).filter((unit) => unit.estate === estate);
    const planted = goldLabeller(
      gold.map((unit) => ({ ...unit, file: LAYOUT[estate][unit.file] ?? unit.file })),
    );
    const model = pointer.createAnthropicLabeler({ key, model: modelName, runs: LIMITS_RUNS });
    const cassette = new pointer.Cassette();
    const reader = readerFor('claude-code', { ignore: [] });
    if (reader === undefined) throw new Error('the claude-code reader is missing');
    await scanEstate({
      root: dir,
      reader,
      rootLabel: 'estate',
      ceiling: 40_000,
      pointer: {
        sets: chainSets(),
        labelling: pointer.singleLabelling(composite(planted, model)),
        cassette,
        mode: 'record',
        estateKey: GOLD_ESTATE_KEY,
        jobs: 2,
      },
    });
    const kept = [...cassette.entries.values()].filter((entry) => entry.readable.set === LIMITS_SET_NAME);
    const only = new pointer.Cassette();
    for (const entry of kept) only.entries.set(entry.key, entry);
    writeFileSync(cassettePath(estate, modelName), only.render());
    return {
      input: kept.reduce((sum, entry) => sum + entry.answer.usage.input, 0),
      output: kept.reduce((sum, entry) => sum + entry.answer.usage.output, 0),
      requests: kept.length,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const modelName = process.env.GOLD_LIMITS_MODEL ?? DEFAULT_LIMITS_MODEL;
const wanted = process.argv
  .slice(2)
  .filter((name): name is EstateName => (ESTATE_NAMES as readonly string[]).includes(name));
if (wanted.length === 0) throw new Error('name the estates to record: A, B, C');
const key = readFileSync(join(homedir(), '.nexus-secrets', 'anthropic-driftbench.key'), 'utf8').trim();
let spend = 0;
for (const estate of wanted) {
  const used = await record(estate, key, modelName);
  // Only the default model has a price in the repository (docs/estate-pointer-reader.md section 11).
  const cost =
    modelName === DEFAULT_LIMITS_MODEL ? used.input * PRICE_IN + used.output * PRICE_OUT : Number.NaN;
  if (!Number.isNaN(cost)) spend += cost;
  console.log(
    `estate ${estate}: ${used.requests} requests, ${used.input} tokens in, ${used.output} out, ${modelName}, USD ${Number.isNaN(cost) ? 'unpriced' : cost.toFixed(4)}`,
  );
}
console.log(`total USD ${spend.toFixed(4)}`);
