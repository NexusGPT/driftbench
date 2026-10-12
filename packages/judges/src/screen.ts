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

/** True when the sentence holds a judge word and a verdict word, each as a whole word or phrase. */
function instructsJudge(sentence: string): boolean {
  const words = sentence.toLowerCase().match(/\p{L}+/gu) ?? [];
  const spoken = ` ${words.join(' ')} `;
  const has = (phrase: string) => spoken.includes(` ${phrase} `);
  return JUDGE_WORDS.some(has) && (VERDICT_WORDS.some(has) || VERDICT_NUMBERS.test(sentence));
}

function screenText(text: string): boolean {
  return sentences(text).some(instructsJudge);
}

/** Screens the observed data of a request: each transcript entry (read with its tool name), the artifact and the Given. */
export function screenData(request: JudgeRequest): ScreenResult {
  const findings: ScreenFinding[] = [];
  request.transcript.forEach((entry, index) => {
    const text = entry.tool ? `${entry.tool} ${entry.text}` : entry.text;
    if (screenText(text)) findings.push({ where: `transcript.${index}` });
  });
  if (request.artifact !== undefined && screenText(request.artifact)) findings.push({ where: 'artifact' });
  if (request.given !== undefined && screenText(JSON.stringify(request.given)))
    findings.push({ where: 'given' });
  return { flagged: findings.length > 0, findings };
}
