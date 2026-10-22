#!/usr/bin/env node
// Prepares a blind re-check of the limits that were added to the gold truth after the producer ran.
//
//   node tools/gold-chain/blind-sample.mjs --seed 20261022 --returned <file> --out-units <file> --out-key <file> [--sample v3]
//
// It takes the units added to the truth (ADDED below) and the same number of decoys, in the same estates, then shuffles
// all of them with a seeded generator. A decoy is a unit of gold5.json whose text holds a digit, that is in neither version
// of the truth (no limit of the file names it as `unit` or `governs`) and that the model never returned
// (`--returned`: one unit id per line). It reads no word of any unit: the filters are a digit, an id in a list and the
// estate. `--out-units` receives one line per unit, the estate and the unit id, nothing else. `--out-key` receives the
// key, which says which units are added and which are decoys; it goes to the person who judges the result, never to the judge.
// `--sample v3` adds 9 positive controls (limits of the original truth) and uses 9 decoys, half with a digit and half instructions.
// The output is the same for the same inputs and seed.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ADDED = {
  A: [
    '2ihgfbfpwv',
    '5fheyswkjr',
    '5fnrtqa4dt',
    'dptij3uzkt',
    'ozfstdpufc',
    'xalkekvnkq',
    'emimqrmqo6',
    'nmk2xrp2r3',
    '4delmkvg75',
  ],
  B: ['2yxq6pbpcn', 'ttzfbmyzfz', 'erb2rbwa26', 'lwci7tropa'],
  C: ['kn447e23qp', 'bidpovjlre', 'txtsbyxu6a', 'x2yw2rftbc', '7xzbzyq5no'],
};

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, value, at, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[at + 1]]] : pairs),
      [],
    ),
);
for (const name of ['seed', 'returned', 'out-units', 'out-key']) {
  if (args[name] === undefined) throw new Error(`missing --${name}`);
}
const root = new URL('../../', import.meta.url).pathname;
const goldPath = args.gold ?? join(root, 'examples/estates/gold5/gold5.json');
const truthDir = args['truth-dir'] ?? join(root, 'examples/estates');
const filter = args.filter ?? 'digit';
if (!['digit', 'instruction'].includes(filter)) throw new Error('--filter is digit or instruction');
const sample = args.sample ?? 'added-and-decoys';
if (!['added-and-decoys', 'v3'].includes(sample)) throw new Error('--sample is added-and-decoys or v3');

const units = JSON.parse(readFileSync(goldPath, 'utf8')).units;
const byId = new Map(units.map((unit) => [unit.id, unit]));
for (const ids of Object.values(ADDED))
  for (const id of ids) if (!byId.has(id)) throw new Error(`${id} is no gold unit`);

// Units that the truth names: the `unit:` and `governs:` ids of the truth files (the current file holds both versions).
const named = new Set();
for (const estate of ['a', 'b', 'c']) {
  const text = readFileSync(join(truthDir, `gold-${estate}`, 'truth.yaml'), 'utf8');
  for (const match of text.matchAll(/^\s*(?:- )?(?:unit|governs):\s*([a-z0-9]{10})\s*$/gm))
    named.add(match[1]);
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

const pool = (estate, exclude, test) =>
  units
    .filter(
      (unit) =>
        unit.estate === estate && !named.has(unit.id) && !returned.has(unit.id) && !exclude.has(unit.id),
    )
    .filter(test)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
const hasDigit = (unit) => /\d/.test(unit.text);
const isInstruction = (unit) => unit.agreed && ['rule', 'prohibition', 'gate'].includes(unit.label);
const addedIds = new Set(Object.values(ADDED).flat());

let all;
if (sample === 'added-and-decoys') {
  const decoys = [];
  for (const [estate, ids] of Object.entries(ADDED)) {
    const found = pool(estate, new Set(ids), filter === 'digit' ? hasDigit : isInstruction);
    if (found.length < ids.length)
      throw new Error(`estate ${estate}: ${found.length} decoy candidates for ${ids.length} places`);
    for (const unit of shuffle(found).slice(0, ids.length))
      decoys.push({ estate, id: unit.id, kind: 'decoy' });
  }
  all = shuffle([
    ...Object.entries(ADDED).flatMap(([estate, ids]) => ids.map((id) => ({ estate, id, kind: 'added' }))),
    ...decoys,
  ]);
} else {
  // v3: the added units, 9 positive controls from the original truth (3 for each estate, a limit whose number sits in
  // its own unit, drawn by seed) and 9 decoys (3 for each estate: 4 with a digit, 5 agreed rule, prohibition or gate).
  // The original truth is the current file without the added units: the additions are the only difference.
  const original = new Map();
  for (const estate of ['a', 'b', 'c']) {
    const text = readFileSync(join(truthDir, `gold-${estate}`, 'truth.yaml'), 'utf8');
    const block = text.slice(text.indexOf('\nlimits:'), text.indexOf('\nscopes:'));
    for (const entry of block.split(/\n\s*- unit:/).slice(1)) {
      const unit = /^\s*([a-z0-9]{10})/.exec(entry)?.[1];
      const governs = /governs:\s*([a-z0-9]{10})/.exec(entry)?.[1];
      if (unit !== undefined && unit === governs && !addedIds.has(unit))
        original.set(unit, estate.toUpperCase());
    }
  }
  const controls = [];
  for (const estate of ['A', 'B', 'C']) {
    const candidates = [...original]
      .filter(([, e]) => e === estate)
      .map(([id]) => id)
      .sort();
    if (candidates.length < 3) throw new Error(`estate ${estate}: ${candidates.length} control candidates`);
    for (const id of shuffle(candidates).slice(0, 3)) controls.push({ estate, id, kind: 'control' });
  }
  const decoys = [];
  const wanted = {
    A: ['digit', 'digit', 'instruction'],
    B: ['digit', 'instruction', 'instruction'],
    C: ['instruction', 'instruction', 'digit'],
  };
  const taken = new Set();
  for (const [estate, kinds] of Object.entries(wanted)) {
    for (const kind of kinds) {
      const found = pool(
        estate,
        new Set([...addedIds, ...taken]),
        kind === 'digit' ? hasDigit : isInstruction,
      );
      const unit = shuffle(found)[0];
      if (unit === undefined) throw new Error(`estate ${estate}: no ${kind} decoy`);
      taken.add(unit.id);
      decoys.push({ estate, id: unit.id, kind: `decoy-${kind}` });
    }
  }
  all = shuffle([
    ...Object.entries(ADDED).flatMap(([estate, ids]) => ids.map((id) => ({ estate, id, kind: 'added' }))),
    ...controls,
    ...decoys,
  ]);
}
writeFileSync(args['out-units'], `${all.map((entry) => `${entry.estate} ${entry.id}`).join('\n')}\n`);
writeFileSync(
  args['out-key'],
  `${JSON.stringify({ seed: Number(args.seed), sample, filter, candidates: 'in neither truth (decoys), never returned by the model', order: all }, null, 2)}\n`,
);
const counts = {};
for (const entry of all) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
console.log(`${all.length} units ${JSON.stringify(counts)}; seed ${args.seed}; sample ${sample}`);
