#!/usr/bin/env node
// Builds the one cassette the ladders legs replay from the recordings of the data branch `cassettes/variables-spans`.
//
//   node tools/variables-span-union.mjs <checkout of the data branch, with its history> <out file>
//
// A span text has ONE label in the result. Two recordings can label a text differently (a model reads a span twice), so
// the rule is fixed, never the order of file names:
//   1. `scale-vocabulary.jsonl` is the single source for the texts it covers: its label wins over every other recording.
//   2. For any other text the newest recording wins, by the date of the last commit that touched its file (then by name).
// The texts are keyed with each run of white space folded to one space, as the adapter looks them up. The tool exits 1
// A recording that labels a text twice keeps its last line. The tool counts every text that got two labels.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const VOCABULARY = 'scale-vocabulary.jsonl';
const fold = (text) => text.replace(/\s+/g, ' ').trim();

/** The files of the checkout in the order that makes the later one win: by date of last change, the vocabulary last. */
export function orderedFiles(dir, dateOf) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => ({ name, date: name === VOCABULARY ? Number.MAX_SAFE_INTEGER : dateOf(name) }))
    .sort((a, b) => a.date - b.date || (a.name < b.name ? -1 : 1))
    .map((entry) => entry.name);
}

export function union(dir, dateOf) {
  const winner = new Map();
  let conflicts = 0;
  for (const name of orderedFiles(dir, dateOf)) {
    const own = new Map();
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      const row = JSON.parse(line);
      const key = fold(row.text);
      const label = JSON.stringify(row.label);
      // A recording that labels a text twice keeps its last line, as the adapter's lookup always did.
      if (own.has(key) && own.get(key) !== label) conflicts += 1;
      own.set(key, label);
    }
    for (const [key, label] of own) {
      if (winner.has(key) && winner.get(key) !== label) conflicts += 1;
      winner.set(key, label);
    }
  }
  const lines = [...winner].map(([key, label]) => `{"text":${JSON.stringify(key)},"label":${label}}\n`);
  return { text: lines.join(''), texts: winner.size, conflicts };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) {
    console.error('usage: node tools/variables-span-union.mjs <data branch checkout> <out file>');
    process.exit(2);
  }
  const dateOf = (name) =>
    Number(
      execFileSync('git', ['-C', dir, 'log', '-1', '--format=%ct', '--', name], { encoding: 'utf8' }).trim(),
    );
  const result = union(dir, dateOf);
  writeFileSync(out, result.text);
  console.log(
    `${result.texts} span texts, one label each; ${result.conflicts} text(s) labelled differently in two recordings, resolved by the rule`,
  );
}
