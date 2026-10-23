#!/usr/bin/env node
// Builds the one cassette the ladders legs replay from the recordings of the data branch `cassettes/variables-spans`.
//
//   node tools/variables-span-union.mjs <checkout of the data branch, with its history> <out file>
//
// A span text has ONE label in the result. Two recordings can label a text differently (a model reads a span twice), so
// the rule is fixed, never the order of file names:
//   1. `scale-vocabulary.jsonl` is the single source for the texts it covers: its label wins over every other recording.
//   2. For any other text the newest recording wins, by the date of the last commit that touched its file (then by name),
//      with one repair: a numeric or range label whose subject shares no word of three letters or more with its own clause
//      ("history length" for "the session exceeds 32 turns") gives way to the newest older label of that text whose subject
//      does. A subject that names none of the clause's words is the less reliable reading, and two spans of one quantity
//      under two subjects become two variables. No word list: the test is only whether the subject and the clause share a
//      word. When no recording names one, the newest label stays.
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

const wordsOf = (text) =>
  new Set(
    String(text)
      .toLowerCase()
      .match(/\p{L}{3,}/gu) ?? [],
  );

/** Whether the subject of a numeric or range label names a word of its clause. Other labels are never questioned. */
export function grounded(text, labelJson) {
  const label = JSON.parse(labelJson);
  if ((label.kind !== 'numeric' && label.kind !== 'range') || typeof label.subject !== 'string') return true;
  const clause = wordsOf(text);
  for (const word of wordsOf(label.subject)) if (clause.has(word)) return true;
  return false;
}

export function union(dir, dateOf) {
  const winner = new Map();
  const history = new Map();
  let conflicts = 0;
  let regrounded = 0;
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
      // The recordings of a text in order; the vocabulary, last, is never questioned.
      const list = history.get(key) ?? [];
      list.push({ label, vocabulary: name === VOCABULARY });
      history.set(key, list);
    }
  }
  for (const [key, list] of history) {
    const newest = list[list.length - 1];
    if (newest.vocabulary || grounded(key, newest.label)) continue;
    const older = [...list.slice(0, -1)]
      .reverse()
      .find((entry) => !entry.vocabulary && grounded(key, entry.label));
    if (older === undefined) continue;
    winner.set(key, older.label);
    regrounded += 1;
  }
  const lines = [...winner].map(([key, label]) => `{"text":${JSON.stringify(key)},"label":${label}}\n`);
  return { text: lines.join(''), texts: winner.size, conflicts, regrounded };
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
    `${result.texts} span texts, one label each; ${result.conflicts} text(s) labelled differently in two recordings, resolved by the rule; ${result.regrounded} label(s) gave way to an older one that names a word of its clause`,
  );
}
