#!/usr/bin/env node
// Labels the condition spans a span-collector run found and writes the cassette the variables measure replays.
//
//   node tools/variables-label-spans.mjs --sha <commit> --spans <dir of variables-spans-N artifacts> --out <file>
//     --usd-per-mtok-in <rate> --usd-per-mtok-out <rate> [--cap <usd, default 2>] [--total-file <file>] [--total-cap <usd, default 8>]
//     [--known <cassette file>] [--batch <spans per request, default 12>]
//
// The key is read from ~/.nexus-secrets/anthropic-driftbench.key and is never printed. Each distinct span is labelled
// once; the cassette holds one JSON line per span, keyed by the span text with each run of white space folded to one space
// (the collector writes the spans folded, and the adapter folds a clause before it looks the label up). The cost is computed from the token
// counts every response reports, at the rates given on the command line, and the run stops before it passes a cap.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = 'claude-haiku-5-5';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (token.startsWith('--')) pairs.push([token.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);
const need = (name) => {
  if (args[name] === undefined) {
    console.error(`missing --${name}`);
    process.exit(2);
  }
  return args[name];
};
const BATCH = Number(args.batch ?? 12);
const sha = need('sha');
const spansDir = need('spans');
const outFile = need('out');
const rateIn = Number(need('usd-per-mtok-in'));
const rateOut = Number(need('usd-per-mtok-out'));
const cap = Number(args.cap ?? 2);
const totalCap = Number(args['total-cap'] ?? 8);
const totalFile = args['total-file'];
const knownFile = args.known;
if (![rateIn, rateOut, cap, totalCap].every((x) => Number.isFinite(x) && x > 0)) {
  console.error('rates and caps must be positive numbers');
  process.exit(2);
}
const spentBefore =
  totalFile && existsSync(totalFile) ? Number(readFileSync(totalFile, 'utf8').trim()) || 0 : 0;

const key = readFileSync(join(homedir(), '.nexus-secrets', 'anthropic-driftbench.key'), 'utf8').trim();

const spans = new Set();
for (const entry of readdirSync(spansDir, { recursive: true })) {
  if (!String(entry).endsWith('.jsonl')) continue;
  for (const line of readFileSync(join(spansDir, String(entry)), 'utf8').split('\n')) {
    if (line.trim() !== '') spans.add(JSON.parse(line).text);
  }
}
const texts = [...spans].sort();
console.log(`commit ${sha}: ${texts.length} distinct spans`);

// The subjects already used in this estate: those of the cassette `--known` names, then those of the labels written so
// far. A batch is shown them, so two clauses that name one quantity in different words get one subject.
const subjects = new Set();
const noteSubjects = (label) => {
  if (label && typeof label.subject === 'string' && label.subject.trim() !== '') subjects.add(label.subject);
};
if (knownFile && existsSync(knownFile)) {
  for (const line of readFileSync(knownFile, 'utf8').split('\n')) {
    if (line.trim() !== '') noteSubjects(JSON.parse(line).label);
  }
}
const MAX_SUBJECTS = 300;
const subjectsBlock = () =>
  subjects.size === 0
    ? ''
    : `Subjects already used in this estate:\n${[...subjects]
        .slice(-MAX_SUBJECTS)
        .map((subject) => `- ${subject}`)
        .join('\n')}\n\nClauses:\n`;

// The store's own definition of a variable, quoted as written in docs/variables.md (the paragraph that opens the
// section "Variables"), so the labeller reads the definition the product uses and no copy of it can drift.
const DOC = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'variables.md');
const definition = (() => {
  const lines = readFileSync(DOC, 'utf8').split('\n');
  const at = lines.findIndex((line) => line.startsWith('A variable is one thing'));
  if (at < 0) throw new Error(`no definition of a variable in ${DOC}`);
  return lines[at];
})();

const SYSTEM = [
  'You read short clauses copied from a company rule file. For each clause, say what condition it states.',
  'Answer with a JSON array, one object per clause, in the order given, and nothing else.',
  `The definition of a variable, as the store states it: ${definition}`,
  'A clause that states no condition under this definition is none.',
  'Each object is one of:',
  '{"kind":"numeric","subject":<what is measured, a short noun phrase>,"limit":<number>,"comparison":"lt"|"le"|"gt"|"ge"|"eq"|"ne","unit":<optional unit>}',
  '{"kind":"range","subject":<noun phrase>,"low":<number>,"high":<number>,"unit":<optional>}',
  '{"kind":"member","subject":<noun phrase>,"members":[<the listed members>]}',
  '{"kind":"boolean","subject":<noun phrase>}  (a fact that is true or false of the case, such as a valve being open or a badge being laminated; a clause that states the fact, or its negation, is boolean)',
  '{"kind":"none"}  (the clause states no condition on a quantity, a set or a yes/no fact)',
  'Name the quantity a clause is about with the same words every time. When a list of subjects already used is given, reuse one of them exactly, character for character, only when the clause itself names that same quantity in its own words; otherwise write the subject the clause names. Never take a listed subject because it is listed.',
  'Write numbers as digits. "at most" is le, "fewer than" is lt, "more than" is gt, "at least" is ge.',
].join('\n');

const NUMERIC = new Set(['lt', 'le', 'gt', 'ge', 'eq', 'ne']);
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const word = (x) => typeof x === 'string' && x.trim() !== '';
const valid = (l) => {
  if (!l || typeof l !== 'object') return false;
  if (l.kind === 'none') return true;
  if (!word(l.subject)) return false;
  if (l.unit !== undefined && !word(l.unit)) return false;
  if (l.kind === 'numeric') return num(l.limit) && NUMERIC.has(l.comparison);
  if (l.kind === 'range') return num(l.low) && num(l.high) && l.low < l.high;
  if (l.kind === 'member') return Array.isArray(l.members) && l.members.length > 0 && l.members.every(word);
  return l.kind === 'boolean';
};

let tokensIn = 0;
let tokensOut = 0;
const spent = () => (tokensIn * rateIn + tokensOut * rateOut) / 1e6;

async function ask(batch) {
  const body = {
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    messages: [
      { role: 'user', content: subjectsBlock() + batch.map((text, i) => `${i + 1}. ${text}`).join('\n') },
    ],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok)
    throw new Error(
      `labeller request failed: ${res.status} ${JSON.stringify(json.error ?? {}).slice(0, 300)}`,
    );
  tokensIn += json.usage?.input_tokens ?? 0;
  tokensOut += json.usage?.output_tokens ?? 0;
  const text = (json.content ?? []).map((c) => c.text ?? '').join('');
  const open = text.indexOf('[');
  const close = text.lastIndexOf(']');
  try {
    const parsed = JSON.parse(text.slice(open, close + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const rows = new Map();
let bad = 0;
for (let i = 0; i < texts.length; i += BATCH) {
  if (spentBefore + spent() > totalCap || spent() > cap) {
    console.error(
      `stopped before a cap: this commit USD ${spent().toFixed(4)}, lane total USD ${(spentBefore + spent()).toFixed(4)}`,
    );
    process.exit(3);
  }
  const batch = texts.slice(i, i + BATCH);
  const answers = await ask(batch);
  // One retry for the clauses that came back unusable.
  const retry = batch.filter((_, j) => !valid(answers[j]));
  if (retry.length > 0) {
    const second = await ask(retry);
    retry.forEach((text, k) => {
      const at = batch.indexOf(text);
      answers[at] = second[k];
    });
  }
  batch.forEach((text, j) => {
    if (valid(answers[j])) {
      rows.set(text, answers[j]);
      noteSubjects(answers[j]);
    } else {
      bad += 1;
      rows.set(text, { kind: 'none' });
    }
  });
}

writeFileSync(outFile, `${[...rows].map(([text, label]) => JSON.stringify({ text, label })).join('\n')}\n`);
const total = spentBefore + spent();
if (totalFile) writeFileSync(totalFile, `${total}\n`);
console.log(`labelled ${rows.size} spans (${bad} unusable answers recorded as none)`);
console.log(
  `tokens in ${tokensIn}, out ${tokensOut}; this commit USD ${spent().toFixed(4)}, lane total USD ${total.toFixed(4)}`,
);
