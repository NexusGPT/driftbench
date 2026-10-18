import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseAnswerText } from '../../../packages/judges/src/contract';
import { buildPrompt } from '../../../packages/judges/src/prompt';
import { weightedPanel } from '../../../packages/judges/src/weighted-panel';
import { auditPrompt, parseAudit } from './audit';
import type { Case, Row } from './generate.mts';

export type Variant = 'ours' | 'theirs' | 'audit' | 'arch';
export type Outcome = 'pass' | 'fail' | 'inconclusive';
export type Prompt = { system: string; user: string };
const qa = readFileSync(new URL('./qa-template.txt', import.meta.url), 'utf8');
const fact = readFileSync(new URL('./fact-template.txt', import.meta.url), 'utf8');
const instructions = readFileSync(new URL('./instructions.txt', import.meta.url), 'utf8');
// Mirrors the pinned upstream neutralizer, including case-insensitivity.
export function neutralize(text: string): string {
  return text.replace(/\[(BEGIN|END) DATA\]/gi, (s) => s.replace(' ', '-'));
}
export function promptFor(c: Case, row: Row, variant: Variant): Prompt {
  if (variant === 'audit') return auditPrompt(c);
  if (variant === 'theirs') {
    const variables: Record<string, string> = {
      question: neutralize(c.question),
      answer: neutralize(c.submission),
      criterion: neutralize(
        row === 'fact'
          ? c.expert
          : `FAIL looks like: ${c.criterion.fail}\nPASS looks like: ${c.criterion.pass}\n${c.criterion.rubric}`,
      ),
      instructions,
    };
    return {
      system: 'You are a grader.',
      user: (row === 'fact' ? fact : qa).replace(
        /\{(question|answer|criterion|instructions)\}/g,
        (_, key: string) => variables[key] ?? '',
      ),
    };
  }
  const prompt = buildPrompt({ criterion: c.criterion, transcript: [{ role: 'agent', text: c.submission }] });
  return prompt;
}
export function parseGrade(text: string): Outcome {
  // Default upstream parser binds the last token, even when it is off-menu.
  const match =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Python whitespace includes U+001C through U+001F, verified against the upstream scorer.
    /.*(?<![\p{L}\p{N}_])GRADE(?![\p{L}\p{N}_])[\s\u0085\u001c-\u001f\u200b-\u200f\u2060\u2063\ufeff]*:[\s\u0085\u001c-\u001f\u200b-\u200f\u2060\u2063\ufeff]*([\p{L}\p{N}_]*)/isu.exec(
      text,
    );
  const word = match?.[1]?.toLowerCase();
  return word === 'c' || word === 'correct'
    ? 'pass'
    : word === 'i' || word === 'incorrect'
      ? 'fail'
      : 'inconclusive';
}
export function parseOutcome(text: string, variant: Variant, submission = ''): Outcome {
  if (variant === 'audit') return parseAudit(text, submission);
  return variant === 'theirs' ? parseGrade(text) : parseAnswerText(text).answer.outcome;
}
export function panel(outcomes: Outcome[]): Outcome {
  const votes = outcomes.map((outcome, i) => ({ judge: `haiku-${i}`, outcome }));
  const decision = weightedPanel(votes, Object.fromEntries(votes.map((v) => [v.judge, 1])));
  return decision === 'split' ? 'inconclusive' : decision;
}
export function wilson(right: number, total: number) {
  if (!total) return { lower: 0, upper: 1 };
  const z = 1.959963984540054,
    p = right / total,
    d = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / d;
  return { lower: center - half, upper: center + half };
}
export function requestSha256(prompt: Prompt, repeat: number): string {
  return createHash('sha256')
    .update(JSON.stringify({ model: 'haiku', prompt, repeat }))
    .digest('hex');
}
export function canCall(spent: number, reserve: number, cap: number): boolean {
  return Number.isFinite(cap) && cap >= 0 && spent + reserve <= cap;
}
