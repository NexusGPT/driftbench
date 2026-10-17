/**
 * The condition reader: the one place the feed reads a quantity out of words. It is a closed grammar, not a
 * guess: a comparison phrase, then a number (digits or a number word), then at most one unit word. A situation
 * with no such phrase, or with two, has no condition, and the feed makes no variable from it. The limit the
 * reader finds is always a word of the quote the value stands on, so it cannot invent one.
 */

export type Comparison = 'lt' | 'le' | 'gt' | 'ge';
export type Condition = {
  comparison: Comparison;
  limit: number;
  unit?: string;
  /** The words of the situation up to the end of the number and its unit: the condition itself, without what follows it. */
  subject: string;
};

const PHRASES: ReadonlyArray<readonly [string, Comparison]> = [
  ['no fewer than', 'ge'],
  ['no less than', 'ge'],
  ['no more than', 'le'],
  ['more than', 'gt'],
  ['greater than', 'gt'],
  ['fewer than', 'lt'],
  ['less than', 'lt'],
  ['at least', 'ge'],
  ['at most', 'le'],
  ['up to', 'le'],
  ['within', 'le'],
  ['above', 'gt'],
  ['over', 'gt'],
  ['under', 'lt'],
  ['below', 'lt'],
];

const WORDS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

/** Words that follow a number without being its unit. */
const NOT_UNITS = new Set([
  'a',
  'an',
  'and',
  'or',
  'the',
  'of',
  'in',
  'on',
  'to',
  'for',
  'is',
  'are',
  'it',
  'then',
  'before',
  'after',
  'by',
  'but',
]);

const NUMBER = `(?:[0-9]+(?:\\.[0-9]+)?|${Object.keys(WORDS).join('|')})`;
const PHRASE = new RegExp(
  `(?<![a-z])(${PHRASES.map(([phrase]) => phrase.replace(' ', '\\s+')).join('|')})\\s+(${NUMBER})(?![a-z0-9.])(?:\\s+([a-z]+))?`,
  'dg',
);

function numberOf(token: string): number {
  return token in WORDS ? (WORDS[token] as number) : Number(token);
}

/** The condition a situation states, or undefined when it states none or more than one. */
export function readCondition(situation: string): Condition | undefined {
  const words = situation.replace(/\s+/g, ' ').trim();
  const text = words.toLowerCase();
  const found = [...text.matchAll(PHRASE)];
  if (found.length !== 1 || text.length !== words.length) return undefined;
  const [, phrase, number, word] = found[0] as RegExpMatchArray;
  const comparison = PHRASES.find(([candidate]) => candidate === (phrase ?? '').replace(/\s+/g, ' '))?.[1];
  if (comparison === undefined || number === undefined) return undefined;
  const unit = word !== undefined && !NOT_UNITS.has(word) && !(word in WORDS) ? word : undefined;
  const indices = (found[0] as RegExpMatchArray & { indices: Array<[number, number] | undefined> }).indices;
  const end = (unit === undefined ? indices[2]?.[1] : indices[3]?.[1]) ?? text.length;
  return {
    comparison,
    limit: numberOf(number),
    ...(unit === undefined ? {} : { unit }),
    subject: words.slice(0, end),
  };
}
