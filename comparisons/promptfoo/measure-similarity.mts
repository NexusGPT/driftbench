// Row 13: levenshtein against similarity. Fictional reply and reference pairs, fixed truth by construction:
// "same" = the reply says the same thing as the reference (paraphrase, reordering, synonyms, case, typos);
// "different" = a different fact (another price, another plan) or unrelated text, including one-character changes.
// Thresholds are chosen on the dev half and scored on the held-out half, split in blocks of two pairs.
// promptfoo's levenshtein is run through its own assertion; ours is the local embedder that our similarity check uses.
// promptfoo's similar (embedding cosine) needs an embedding API, so it is not measured here.
// Run from the repository root: npx tsx comparisons/promptfoo/measure-similarity.mts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localEmbedder } from '../../packages/core/src/text/embedder';
import { mulberry32 } from '../../packages/stats/src/index';
// @ts-expect-error the installed package ships compiled JavaScript without declarations
import * as pf from './node_modules/promptfoo/dist/src/index.js';
import { type Row, summarise } from './summary.mts';

const HERE = dirname(fileURLToPath(import.meta.url));
const rng = mulberry32(13);
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;

const PLANS = [
  { name: 'Mobile S', price: 19, data: 10 },
  { name: 'Mobile M', price: 25, data: 40 },
  { name: 'Mobile L', price: 35, data: 80 },
  { name: 'Fiber 100', price: 45, data: 0 },
];

type Pair = { reference: string; reply: string; same: boolean };

function reference(p: (typeof PLANS)[number]): string {
  return p.data > 0
    ? `${p.name} costs ${p.price} USD a month and includes ${p.data} GB of data.`
    : `${p.name} costs ${p.price} USD a month with a fixed line included.`;
}

// Paraphrases: same facts, different words, order, case or punctuation.
function same(p: (typeof PLANS)[number], kind: number): string {
  const data = p.data > 0 ? `${p.data} GB of data` : 'a fixed line';
  switch (kind % 6) {
    case 0:
      return p.data > 0
        ? `${p.name} includes ${p.data} GB of data and is priced at ${p.price} USD per month.`
        : `${p.name} is priced at ${p.price} USD per month, with a fixed line included.`;
    case 1:
      return reference(p).toLowerCase();
    case 2:
      return reference(p)
        .replace(/\./g, '')
        .replace(/ costs /, ' costs  ');
    case 3:
      return `For ${p.price} USD a month you get ${p.name}${p.data > 0 ? ` with ${data}` : ` with ${data}`}.`;
    case 4:
      return reference(p).replace('costs', 'comes to').replace('includes', 'with');
    default:
      return reference(p).replace(/o/g, 'o').replace('Mobile', 'Mobil'); // one-letter typo
  }
}

// Different facts: another price or plan, close in characters to the reference, or unrelated text.
function different(p: (typeof PLANS)[number], kind: number): string {
  const other = PLANS.find((q) => q.name !== p.name) ?? p;
  switch (kind % 4) {
    case 0:
      return reference(p).replace(String(p.price), String(p.price + 10));
    case 1:
      return reference(p).replace(p.name, other.name);
    case 2:
      return `Our opening hours are 9 to 18 on weekdays, and the shop closes early on Sundays.`;
    default:
      return `Sorry, I cannot help with that request today; please call our advisors.`;
  }
}

const pairs: Pair[] = [];
for (let i = 0; i < 200; i++) {
  const p = pick(PLANS);
  const isSame = i % 2 === 0;
  pairs.push({ reference: reference(p), reply: isSame ? same(p, i) : different(p, i), same: isSame });
}

// Blocks of two: the same and different pairs alternate by index, so a plain even/odd split would put one kind in each half.
const dev = pairs.filter((_, i) => Math.floor(i / 2) % 2 === 0);
const held = pairs.filter((_, i) => Math.floor(i / 2) % 2 === 1);

async function theirsPass(pair: Pair, threshold: number): Promise<boolean> {
  const result = await pf.assertions.runAssertion({
    assertion: { type: 'levenshtein', value: pair.reference, threshold },
    test: { vars: {}, assert: [] },
    providerResponse: { output: pair.reply },
    prompt: '',
    vars: {},
  });
  return result.pass === true;
}

async function oursPass(pair: Pair, min: number, scores: Map<string, number>): Promise<boolean> {
  const key = `${pair.reply}\u0000${pair.reference}`;
  let score = scores.get(key);
  if (score === undefined) {
    score = await localEmbedder.similarity(pair.reply, pair.reference);
    scores.set(key, score);
  }
  return score >= min;
}

const accuracy = (rows: Array<{ truth: boolean; pass: boolean }>) =>
  rows.filter((r) => r.pass === r.truth).length / rows.length;

// promptfoo: levenshtein thresholds in characters, from 0 to 120.
const theirGrid = Array.from({ length: 121 }, (_, t) => t);
let bestT = 0;
let bestTAcc = -1;
for (const t of theirGrid) {
  const rows = [];
  for (const pair of dev) rows.push({ truth: pair.same, pass: await theirsPass(pair, t) });
  const acc = accuracy(rows);
  if (acc > bestTAcc) {
    bestTAcc = acc;
    bestT = t;
  }
}

// ours: the local embedder's similarity, minimum from 0.00 to 1.00 in steps of 0.01.
const scores = new Map<string, number>();
const oursGrid = Array.from({ length: 101 }, (_, i) => i / 100);
let bestM = 0;
let bestMAcc = -1;
for (const m of oursGrid) {
  const rows = [];
  for (const pair of dev) rows.push({ truth: pair.same, pass: await oursPass(pair, m, scores) });
  const acc = accuracy(rows);
  if (acc > bestMAcc) {
    bestMAcc = acc;
    bestM = m;
  }
}

const heldRows: Row[] = [];
for (const pair of held) {
  heldRows.push({
    truth: pair.same,
    a: await theirsPass(pair, bestT),
    b: await oursPass(pair, bestM, scores),
  });
}
const summary = summarise(
  '13 levenshtein (promptfoo) against similarity (ours, local embedder), held-out half',
  heldRows,
  ['theirs', 'ours'],
);
const out = {
  ...summary,
  chosenOnDev: {
    levenshteinThresholdChars: bestT,
    devAccuracy: bestTAcc,
    oursMinimum: bestM,
    oursDevAccuracy: bestMAcc,
  },
  pairs: pairs.length,
  same: pairs.filter((p) => p.same).length,
  note: 'promptfoo similar (embedding cosine) is not measured: it needs an embedding API.',
};
await mkdir(join(HERE, 'out'), { recursive: true });
await writeFile(join(HERE, 'out', 'similarity.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out));
