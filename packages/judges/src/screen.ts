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

/**
 * The readings of a text a screen looks at: the text as written, then each way a writer can hide words in it. Each
 * reading is a whole text that is split into sentences like the original.
 */
const READINGS: readonly ((text: string) => string | undefined)[] = [
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
