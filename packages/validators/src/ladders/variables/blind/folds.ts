import type { Rng } from '../bank/util';

/**
 * Seeded texts for the quote items that test the folding of docs/variables.md Provenance. Each function returns
 * the text the file holds and the text the quote carries; the two differ only in what the page folds (or, for the
 * `differs` kind, in one thing it does not fold). The words are made up from a short pool, the place of a mark in
 * a word and the kind of white space change with the seed.
 */

const WORDS = [
  'refund',
  'parcel',
  'supplier',
  'customer',
  'invoice',
  'order',
  'policy',
  'approval',
  'ticket',
  'lookup',
  'shipment',
  'escalation',
  'receipt',
  'warranty',
  'courier',
  'voucher',
] as const;
const CONNECTORS = ['the', 'our', 'each', 'every'] as const;
const VERBS = ['holds', 'applies', 'stays', 'counts', 'waits'] as const;
const RUNS = ['  ', '   ', '\t', '\n', ' \t', '\r\n', ' \n ', '\t\t'] as const;
const INVISIBLE = ['​', '‌', '‍', '⁠'] as const;
const ACCENTED = [
  'café crème',
  'déjà vu',
  'crêpe suzette',
  'naïve façade',
  'señor niño',
  'élève zélé',
  'forêt noël',
] as const;

export type Pair = { inFile: string; inQuote: string };

/** `count` distinct words in a seeded order. */
function some(rng: Rng, count: number): string[] {
  return rng.sample(WORDS, count);
}

/** A sentence of the form `the A B holds`. */
function sentence(rng: Rng, count = 2): string {
  return `${rng.pick(CONNECTORS)} ${some(rng, count).join(' ')} ${rng.pick(VERBS)}`;
}

/** The words of a sentence joined by a run of white space that is never a single space. */
function runs(rng: Rng, text: string): string {
  return text
    .split(' ')
    .map((w, i, all) => (i < all.length - 1 ? `${w}${rng.pick(RUNS)}` : w))
    .join('');
}

/** Puts `mark` inside a word of the text, away from its ends. */
function inside(rng: Rng, text: string, mark: string): string {
  const spots = [...text]
    .map((c, i) => i)
    .filter(
      (i) =>
        /\p{L}/u.test(text[i] ?? '') && /\p{L}/u.test(text[i - 1] ?? '') && /\p{L}/u.test(text[i + 1] ?? ''),
    );
  if (spots.length === 0) return text;
  const at = rng.pick(spots);
  return `${text.slice(0, at)}${mark}${text.slice(at)}`;
}

/** The file around a text: a heading, a sentence before it and one after it. */
export function around(rng: Rng, text: string): string {
  const head = rng.pick(['# Notes', '## Desk rules', 'Desk rules\n==========']);
  return `${head}\n\n${sentence(rng)} here. ${text} ${sentence(rng)} there.\n`;
}

export const whiteSpaceInTheQuote = (rng: Rng): Pair => {
  const s = sentence(rng, 3);
  return { inFile: s, inQuote: runs(rng, s) };
};
export const whiteSpaceInTheFile = (rng: Rng): Pair => {
  const s = sentence(rng, 3);
  return { inFile: runs(rng, s), inQuote: s };
};

export const doubleQuotesInTheFile = (rng: Rng): Pair => {
  const [w] = some(rng, 1);
  const who = rng.pick(['He', 'She', 'The agent', 'A customer']);
  const tail = rng.pick(['at once', 'twice', 'on the phone']);
  return { inFile: `${who} said “${w}” ${tail}`, inQuote: `${who} said "${w}" ${tail}` };
};
export const singleQuotesInTheFile = (rng: Rng): Pair => {
  const [w] = some(rng, 1);
  const who = rng.pick(['It', 'That', 'Here']);
  const noun = rng.pick(['desk', 'queue', 'line']);
  return {
    inFile: `${who}’s the ‘${w}’ ${noun}`,
    inQuote: `${who}'s the '${w}' ${noun}`,
  };
};
export const typographicQuotesInTheQuote = (rng: Rng): Pair => {
  const [w] = some(rng, 1);
  const who = rng.pick(['He', 'She', 'The agent']);
  const tail = rng.pick(['final', 'binding', 'recorded']);
  return {
    inFile: `${who} said "${w}" at once, it's ${tail}`,
    inQuote: `${who} said “${w}” at once, it’s ${tail}`,
  };
};

export const composedInTheFile = (rng: Rng): Pair => {
  const s = `${rng.pick(['Le', 'Un', 'Notre'])} ${rng.pick(ACCENTED)}`;
  return { inFile: s.normalize('NFC'), inQuote: s.normalize('NFD') };
};
export const decomposedInTheFile = (rng: Rng): Pair => {
  const s = `${rng.pick(['Le', 'Un', 'Notre'])} ${rng.pick(ACCENTED)}`;
  return { inFile: s.normalize('NFD'), inQuote: s.normalize('NFC') };
};

function marked(rng: Rng, s: string, count: number, marks: readonly string[]): string {
  let out = s;
  for (let i = 0; i < count; i += 1) out = inside(rng, out, rng.pick(marks));
  return out;
}
export const zeroWidthInTheFile = (rng: Rng): Pair => {
  const s = sentence(rng);
  return { inFile: marked(rng, s, rng.int(2, 4), INVISIBLE), inQuote: s };
};
export const zeroWidthInTheQuote = (rng: Rng): Pair => {
  const s = sentence(rng);
  return { inFile: s, inQuote: marked(rng, s, rng.int(2, 4), [...INVISIBLE, '﻿']) };
};
export const softHyphen = (rng: Rng): Pair => {
  const s = sentence(rng);
  return { inFile: marked(rng, s, rng.int(1, 2), ['­']), inQuote: s };
};

export const backslashBeforeAsterisk = (rng: Rng): Pair => {
  const [w] = some(rng, 1);
  const lead = rng.pick(['Use the', 'Add the', 'Keep the']);
  return { inFile: `${lead} \\*${w}\\* tag`, inQuote: `${lead} *${w}* tag` };
};
export const backslashBeforeUnderscore = (rng: Rng): Pair => {
  const [a, b] = some(rng, 2);
  const lead = rng.pick(['Keep', 'Use', 'Write']);
  return { inFile: `${lead} ${a}\\_${b} names`, inQuote: `${lead} ${a}_${b} names` };
};

export const caseMustMatch = (rng: Rng): Pair => {
  const s = `${rng.pick(['Never', 'Always', 'Only'])} ${some(rng, 2).join(' ')} ${rng.pick(VERBS)}`;
  return { inFile: s, inQuote: `${s[0]?.toLowerCase()}${s.slice(1)}` };
};
export const punctuationMustMatch = (rng: Rng): Pair => {
  const [a, b] = some(rng, 2);
  const [from, to] = rng.sample([',', ';', ':', '.'], 2) as [string, string];
  return { inFile: `${a}${from} then ask ${b}`, inQuote: `${a}${to} then ask ${b}` };
};
export const missingWord = (rng: Rng): Pair => {
  const words = [
    rng.pick(['tell', 'show', 'send']),
    'the',
    some(rng, 1)[0] as string,
    'and',
    'offer',
    'a',
    some(rng, 1)[0] as string,
  ];
  const drop = rng.int(1, words.length - 2);
  return { inFile: words.join(' '), inQuote: words.filter((_, i) => i !== drop).join(' ') };
};
export const accentMustMatch = (rng: Rng): Pair => {
  const word = rng.pick(['café', 'crème', 'élève', 'forêt', 'naïve']);
  const plain = word.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return { inFile: `Le ${word} is open`, inQuote: `Le ${plain} is open` };
};
