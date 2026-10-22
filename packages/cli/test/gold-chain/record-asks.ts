/**
 * Records the per-atom limit requests of the gold estates, once. Run it by hand, never in CI:
 *
 *   GOLD_ASK_CAP_IN=400000 GOLD_ASK_CAP_OUT=100000 pnpm exec tsx packages/cli/test/gold-chain/record-asks.ts A B C
 *
 * The key is read from ~/.nexus-secrets/anthropic-driftbench.key, kept in memory and never printed. Each instruction
 * atom of the estate (with the gold labels planted) gets one request holding its quote; the answers are appended to
 * examples/estates/gold-<x>/limits.ask.<model>.jsonl, and the chain replays them. The cost is the tokens the answers
 * report times the price of docs/estate-pointer-reader.md section 11 (USD 0.10 per million input, 0.50 per million output).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pointer, readerFor, scanEstate } from '@agent-nexus/driftbench-estate';
import {
  ESTATE_NAMES,
  type EstateName,
  estateFiles,
  GOLD_ESTATE_KEY,
  GOLD_SET_YAML,
  goldLabeller,
  loadGold,
} from '../../../estate/test/gold/gold';
import { loadTruth } from '../../../estate/test/gold/truth';
import { LAYOUT } from './layout';
import { appliedScopes } from './scopes';
import { ASK_MODEL, answerFor, contextOf, loadAsks, readKey } from './limits-ask';

const capIn = Number(process.env.GOLD_ASK_CAP_IN ?? Number.POSITIVE_INFINITY);
const capOut = Number(process.env.GOLD_ASK_CAP_OUT ?? Number.POSITIVE_INFINITY);

async function record(estate: EstateName, key: string) {
  const dir = await mkdtemp(join(tmpdir(), `record-asks-${estate}-`));
  try {
    for (const file of await estateFiles(estate)) {
      const target = join(dir, LAYOUT[estate][file.path] ?? '');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.text);
    }
    const gold = (await loadGold()).filter((unit) => unit.estate === estate);
    // The scopes of the truth file are planted as the chain plants them, so the atoms and their situations are the same.
    const { truth } = await loadTruth(estate, gold);
    const placeOf = new Map(gold.map((unit) => [unit.id, `${LAYOUT[estate][unit.file]}#${unit.n}`]));
    const scopes = [...appliedScopes(gold, truth.scopes).applied.values()].map((scope) => ({
      unit: placeOf.get(scope.unit) ?? '',
      target: placeOf.get(scope.target) ?? '',
    }));
    const planted = goldLabeller(
      gold.map((unit) => ({ ...unit, file: LAYOUT[estate][unit.file] ?? unit.file })),
      [],
      scopes,
    );
    const reader = readerFor('claude-code', { ignore: [] });
    if (reader === undefined) throw new Error('the claude-code reader is missing');
    const parsed = pointer.parseLabelSets(GOLD_SET_YAML);
    if (!parsed.ok) throw new Error(parsed.message);
    const scan = await scanEstate({
      root: dir,
      reader,
      rootLabel: 'estate',
      ceiling: 40_000,
      pointer: {
        sets: parsed.sets,
        labelling: pointer.singleLabelling(planted),
        cassette: new pointer.Cassette(),
        mode: 'record',
        estateKey: GOLD_ESTATE_KEY,
      },
    });
    const texts = new Map<string, string>();
    for (const path of Object.values(LAYOUT[estate]))
      texts.set(path, await readFile(join(dir, path), 'utf8'));
    const asks = new Map<string, { quote: string; context: string }>();
    for (const atom of scan.map.atoms) {
      if (atom.kind !== 'instruction' || atom.fields?.extraction !== 'pointer') continue;
      const context = contextOf(texts.get(atom.provenance.file) ?? '', atom.provenance.startLine, atom.situation);
      asks.set(`${atom.provenance.quote}\n${context}`, { quote: atom.provenance.quote, context });
    }
    const quotes = [...asks.values()];
    const cache = loadAsks(estate, ASK_MODEL);
    const spent = { input: 0, output: 0, requests: 0 };
    let next = 0;
    const worker = async () => {
      for (;;) {
        const ask = quotes[next++];
        if (ask === undefined) return;
        await answerFor(estate, ASK_MODEL, ask.quote, ask.context, cache, spent, { key, capIn, capOut });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { ...spent, quotes: quotes.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const wanted = process.argv
  .slice(2)
  .filter((name): name is EstateName => (ESTATE_NAMES as readonly string[]).includes(name));
if (wanted.length === 0) throw new Error('name the estates to record: A, B, C');
const key = readKey();
let total = 0;
for (const estate of wanted) {
  const used = await record(estate, key);
  const cost = used.input * (0.1 / 1_000_000) + used.output * (0.5 / 1_000_000);
  total += cost;
  console.log(
    `estate ${estate}: ${used.quotes} instruction atoms, ${used.requests} requests sent, ${used.input} tokens in, ${used.output} out, USD ${cost.toFixed(4)}`,
  );
}
console.log(`total USD ${total.toFixed(4)}`);
