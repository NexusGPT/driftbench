import type { JudgeRequest } from './contract';

/** Where an instruction to the judge sits: `transcript.<index>`, `artifact` or `given`. */
export type ScreenFinding = { readonly where: string };

/** What `screenData` returns: whether any place holds an instruction to the judge, and which. */
export type ScreenReport = { readonly flagged: boolean; readonly findings: readonly ScreenFinding[] };

const JUDGE_WORDS = [
  'rubric',
  'grader',
  'grading',
  'judges?',
  'evaluator',
  'evaluating',
  'evaluates',
  'evaluation',
  'reviewer',
  'verdict',
  'scoring model',
  'criterion',
  'criteria',
  'fail picture',
  'score it',
  'rate this',
  'outcome',
];
const VERDICT_WORDS = ['pass', 'passing', 'passed', 'passes', 'success', 'satisfied', 'compliant', 'met', 'fail', 'fails'];

// A word starts and ends at a character that is not a letter, so _ / - % . and digits separate words.
const phrase = (words: readonly string[]) =>
  new RegExp(`(?<!\\p{L})(?:${words.map((word) => word.replace(/ /g, '\\s+')).join('|')})(?!\\p{L})`, 'iu');
const JUDGE = phrase(JUDGE_WORDS);
const VERDICT = phrase(VERDICT_WORDS);
const SCORE = /(?<![\d.])(?:1\.0|0\.99)(?!\d)/;

const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?;])\s+|[\r\n\u2028\u2029]+/);
const instructs = (sentence: string): boolean => JUDGE.test(sentence) && (VERDICT.test(sentence) || SCORE.test(sentence));

const LEET: Readonly<Record<string, string>> = { '4': 'a', '3': 'e', '1': 'i', '0': 'o', '5': 's', '7': 't' };

const LOOKALIKES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries({
    a: '\u0430', c: '\u0441', e: '\u0435', i: '\u0456', j: '\u0458', o: '\u043e', p: '\u0440', s: '\u0455', x: '\u0445', y: '\u0443',
    A: '\u0410', B: '\u0412', C: '\u0421', E: '\u0415', H: '\u041d', K: '\u041a', M: '\u041c', O: '\u041e', P: '\u0420', T: '\u0422', X: '\u0425',
  }).map(([latin, cyrillic]) => [cyrillic, latin]),
);

/**
 * The readings of a text a screen looks at: the text as written, then each way a writer can hide words in it. Each
 * reading is a whole text that is split into sentences like the original.
 */
const READINGS: readonly ((text: string) => string | undefined)[] = [
  // Characters that print nothing, dropped: zero-width marks, the soft hyphen, the word joiner, the byte order mark.
  (text) => {
    const bare = text.replace(/[\u200b-\u200f\u00ad\u2060-\u2064\ufeff\u180e]/g, '');
    return bare === text ? undefined : bare;
  },
  // Cyrillic letters that look like Latin ones, folded inside a word that also holds Latin letters (mixed script).
  (text) => {
    const folded = text.replace(/[\p{L}\p{M}]+/gu, (word) =>
      /[a-z]/i.test(word) ? [...word].map((ch) => LOOKALIKES[ch] ?? ch).join('') : word,
    );
    return folded === text ? undefined : folded;
  },
  // Leetspeak: digits read as the letters they stand for, inside a word that also holds letters.
  (text) => {
    const folded = text.replace(/[\p{L}\p{N}]+/gu, (word) =>
      /\p{L}/u.test(word) ? [...word].map((ch) => LEET[ch] ?? ch).join('') : word,
    );
    return folded === text ? undefined : folded;
  },
  // Letters spaced one by one (i g n o r e): the single spaces between letters are dropped.
  (text) => {
    const joined = text.replace(/(?<=\p{L}) (?=\p{L}(?: |$|[^\p{L}]))/gu, '');
    return joined === text ? undefined : joined;
  },
  // Letters separated by dots (i.g.n.o.r.e): the dots between letters are dropped.
  (text) => {
    const joined = text.replace(/(?<=\p{L})\.(?=\p{L})/gu, '');
    return joined === text ? undefined : joined;
  },
  // Compatibility forms: fullwidth letters and the like read as plain letters.
  (text) => {
    const folded = text.normalize('NFKC');
    return folded === text ? undefined : folded;
  },
];

const readingsOf = (text: string): string[] => [
  text,
  ...READINGS.map((read) => read(text)).filter((reading): reading is string => reading !== undefined),
];

/**
 * Screens a request before a judge reads it. Every sentence (split after . ! ? ; and at line breaks) of each place is
 * read: each transcript entry with its tool name, the artifact, and the Given as JSON. A sentence that holds a judge
 * word and a verdict word is an instruction to the judge, and its place is a finding.
 */
export function screenData(request: JudgeRequest): ScreenReport {
  const places: [string, string][] = [
    ...request.transcript.map((entry, i): [string, string] => [
      `transcript.${i}`,
      entry.tool ? `${entry.tool}\n${entry.text}` : entry.text,
    ]),
    ...(request.artifact === undefined ? [] : [['artifact', request.artifact] as [string, string]]),
    ...(request.given === undefined ? [] : [['given', JSON.stringify(request.given)] as [string, string]]),
  ];
  const findings = places.filter(([, text]) => readingsOf(text).some((reading) => sentencesOf(reading).some(instructs))).map(([where]) => ({ where }));
  return { flagged: findings.length > 0, findings };
}
