import type { JudgeRequest } from './contract';

/**
 * The data screen: a sentence in the observed data that speaks to the judge (a judge word and a verdict word
 * in one sentence) is flagged at the place it sits. A judge reads the data as data; the screen tells the caller
 * where a planted instruction may be, before a judge is asked.
 */

const JUDGE_WORDS = [
  'rubric',
  'grader',
  'grading',
  'judge',
  'judges',
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

const VERDICT_WORDS = [
  'pass',
  'passing',
  'passed',
  'passes',
  'success',
  'satisfied',
  'compliant',
  'met',
  'fail',
  'fails',
];

const VERDICT_NUMBERS = /(?<![\d.])(?:1\.0|0\.99)(?!\d)/;

export type ScreenFinding = { where: string };
export type ScreenResult = { flagged: boolean; findings: ScreenFinding[] };

/** A sentence ends at . ! ? or ; when a space or the end follows, and at a line break. */
function sentences(text: string): string[] {
  return text.split(/[.!?;]+(?=\s|$)|[\r\n]+/);
}

const OBLIGATIONS = ['always', 'must', 'never', 'should'];

/** A command anywhere in the sentence: the data may append an instruction to a sentence of its own. */
const COMMANDS = [
  /(?<!\p{L})(?:ignore|disregard|override|answer|respond|mark|output|return|report|rate|set|treat|consider|give|pick)(?!\p{L})/iu,
  /(?<!\p{L})forget (?:your|the rubric|the criteria|the grading|all)(?!\p{L})/iu,
  /(?<!\p{L})do not apply(?!\p{L})/iu,
  /(?<!\p{L})score (?:it|this)(?!\p{L})/iu,
  /(?<!\p{L})scale from \d/iu,
  /(?<!\p{L})(?:pass|fail) picture(?!\p{L})/iu,
  /(?<!\p{L})you are(?!\p{L})/iu,
];

/** A judge word opening a sentence and followed by a comma or colon: the sentence is addressed to the judge. */
const ADDRESSED = new RegExp(
  `(?:^|\\s)(?:${JUDGE_WORDS.join('|')})(?:\\s+\\S+){0,2}\\s*[,:]|(?:^|[\\s_])(?:${JUDGE_WORDS.join('|')})[\\s_]+note(?!\\p{L})`,
  'i',
);

/** True when the sentence reads as written to the reader: a command, an obligation, or a note addressed to the judge. */
function instructs(sentence: string, words: readonly string[]): boolean {
  const spoken = ` ${words.join(' ')} `;
  const has = (phrase: string) => spoken.includes(` ${phrase} `);
  return (
    COMMANDS.some((command) => command.test(sentence)) ||
    OBLIGATIONS.some(has) ||
    ADDRESSED.test(sentence.trim())
  );
}

/** True when the sentence holds a judge word and a verdict word, each as a whole word or phrase, and instructs. */
function instructsJudge(sentence: string): boolean {
  const words = sentence.toLowerCase().match(/\p{L}+/gu) ?? [];
  const spoken = ` ${words.join(' ')} `;
  const has = (phrase: string) => spoken.includes(` ${phrase} `);
  if (!JUDGE_WORDS.some(has)) return false;
  if (!(VERDICT_WORDS.some(has) || VERDICT_NUMBERS.test(sentence))) return false;
  return instructs(sentence, words);
}

function screenText(text: string): boolean {
  return sentences(text).some(instructsJudge);
}

/** The strings of a JSON-like value, keys included, each on its own line, so a sentence keeps its words. */
function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value !== null && typeof value === 'object')
    return Object.entries(value).flatMap(([key, inner]) =>
      typeof inner === 'string' ? [`${key}: ${inner}`] : [key, ...stringLeaves(inner)],
    );
  return [];
}

/** The text of an entry: a JSON body is read as its strings, so its values and keys are sentences too. */
function readable(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text;
  try {
    return stringLeaves(JSON.parse(trimmed)).join('\n');
  } catch {
    return text;
  }
}

/** Screens the observed data of a request: each transcript entry (read with its tool name), the artifact and the Given. */
export function screenData(request: JudgeRequest): ScreenResult {
  const findings: ScreenFinding[] = [];
  request.transcript.forEach((entry, index) => {
    const flagged = screenText(readable(entry.text)) || (entry.tool !== undefined && screenText(entry.tool));
    if (flagged) findings.push({ where: `transcript.${index}` });
  });
  if (request.artifact !== undefined && screenText(request.artifact)) findings.push({ where: 'artifact' });
  if (request.given !== undefined && screenText(stringLeaves(request.given).join('\n')))
    findings.push({ where: 'given' });
  return { flagged: findings.length > 0, findings };
}
