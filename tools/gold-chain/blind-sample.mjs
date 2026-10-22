#!/usr/bin/env node
// Prepares a blind re-check of the limits that were added to the gold truth after the producer ran.
//
//   node tools/gold-chain/blind-sample.mjs --seed 20261022 --returned <file> --out-units <file> --out-key <file>
//
// It takes the units added to the truth (ADDED below) and the same number of decoys, in the same estates, then shuffles
// all of them with a seeded generator. A decoy is a unit of gold5.json whose text holds a digit, that is in neither version
// of the truth (no limit of the file names it as `unit` or `governs`) and that the model never returned
// (`--returned`: one unit id per line). It reads no word of any unit: the filters are a digit, an id in a list and the
// estate. `--out-units` receives one line per unit, the estate and the unit id, nothing else. `--out-key` receives the
// key, which says which units are added and which are decoys; it goes to the person who judges the result, never to the judge.
// The output is the same for the same inputs and seed.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ADDED = {
  A: ['2ihgfbfpwv', '5fheyswkjr', '5fnrtqa4dt', 'dptij3uzkt', 'ozfstdpufc', 'xalkekvnkq', 'emimqrmqo6', 'nmk2xrp2r3', '4delmkvg75'],
  B: ['2yxq6pbpcn', 'ttzfbmyzfz', 'erb2rbwa26', 'lwci7tropa'],
  C: ['kn447e23qp', 'bidpovjlre', 'txtsbyxu6a', 'x2yw2rftbc', '7xzbzyq5no'],
};

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, at, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[at + 1]]] : pairs), []),
);
for (const name of ['seed', 'returned', 'out-units', 'out-key']) {
  if (args[name] === undefined) throw new Error(`missing --${name}`);
}
const root = new URL('../../', import.meta.url).pathname;
const goldPath = args.gold ?? join(root, 'examples/estates/gold5/gold5.json');
const truthDir = args['truth-dir'] ?? join(root, 'examples/estates');
const filter = args.filter ?? 'digit';
if (!['digit', 'instruction'].includes(filter)) throw new Error('--filter is digit or instruction');

const units = JSON.parse(readFileSync(goldPath, 'utf8')).units;
const byId = new Map(units.map((unit) => [unit.id, unit]));
for (const ids of Object.values(ADDED)) for (const id of ids) if (!byId.has(id)) throw new Error(`${id} is no gold unit`);

// Units that the truth names: the `unit:` and `governs:` ids of the truth files (the current file holds both versions).
const named = new Set();
for (const estate of ['a', 'b', 'c']) {
  const text = readFileSync(join(truthDir, `gold-${estate}`, 'truth.yaml'), 'utf8');
  for (const match of text.matchAll(/^\s*(?:- )?(?:unit|governs):\s*([a-z0-9]{10})\s*$/gm)) named.add(match[1]);
}
const returned = new Set(
  readFileSync(args.returned, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9]{10}$/.test(line)),
);

// A small seeded generator (mulberry32) and a seeded Fisher-Yates shuffle.
function generator(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = generator(args.seed);
const shuffle = (list) => {
  const out = [...list];
  for (let at = out.length - 1; at > 0; at--) {
    const other = Math.floor(random() * (at + 1));
    [out[at], out[other]] = [out[other], out[at]];
  }
  return out;
};

const decoys = [];
for (const [estate, ids] of Object.entries(ADDED)) {
  const added = new Set(ids);
  const pool = units
    .filter((unit) => unit.estate === estate && !named.has(unit.id) && !returned.has(unit.id) && !added.has(unit.id))
    .filter((unit) => (filter === 'digit' ? /\d/.test(unit.text) : unit.agreed && ['rule', 'prohibition', 'gate'].includes(unit.label)))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (pool.length < ids.length) throw new Error(`estate ${estate}: ${pool.length} decoy candidates for ${ids.length} places`);
  for (const unit of shuffle(pool).slice(0, ids.length)) decoys.push({ estate, id: unit.id, kind: 'decoy' });
}
const all = shuffle([
  ...Object.entries(ADDED).flatMap(([estate, ids]) => ids.map((id) => ({ estate, id, kind: 'added' }))),
  ...decoys,
]);
writeFileSync(args['out-units'], `${all.map((entry) => `${entry.estate} ${entry.id}`).join('\n')}\n`);
writeFileSync(
  args['out-key'],
  `${JSON.stringify({ seed: Number(args.seed), filter, candidates: 'digit text, in neither truth, never returned by the model', order: all }, null, 2)}\n`,
);
console.log(`${all.length} units: ${all.filter((entry) => entry.kind === 'added').length} added, ${all.filter((entry) => entry.kind === 'decoy').length} decoys; seed ${args.seed}; filter ${filter}`);
