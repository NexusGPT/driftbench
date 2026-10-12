import type { CriterionText } from './contract';

/** One defect that makes a rubric hard to answer the same way twice. */
export type LintIssue = { readonly code: string };

type Rule = { readonly code: string; readonly found: (criterion: CriterionText) => boolean };

/**
 * The rubric defects `lintCriterion` knows. One entry per code, in the order the docs list them; a rubric without
 * the defect gives no issue.
 */
const RULES: readonly Rule[] = [
  // More than one question mark: a judge cannot answer two questions with one verdict.
  { code: 'two-questions', found: (c) => (c.rubric.match(/\?/g) ?? []).length > 1 },
  // A taste word: two judges read it two ways.
  { code: 'subjective', found: (c) => /\b(good|appropriate|nice|reasonable|properly|adequate|helpful|polite|professional|friendly)\b/i.test(c.rubric) },
  // A quantity word that hides the count.
  { code: 'vague-quantity', found: (c) => /\b(some|several|many|often|usually|mostly|a few|most of the time)\b/i.test(c.rubric) },
  // Two negations in one sentence: the judge has to cancel them in its head.
  { code: 'double-negative', found: (c) => sentences(c.rubric).some((sentence) => negations(sentence) >= 2) },
  // Nothing a judge can read: no reply, agent, message, tool, call, order, customer, user, file or transcript.
  {
    code: 'no-observable',
    found: (c) => !/\b(repl(y|ies)|agents?|assistants?|messages?|tools?|calls?|orders?|customers?|users?|files?|transcripts?)\b/i.test(c.rubric),
  },
  // Over 400 characters: the question is lost in the text.
  { code: 'too-long', found: (c) => c.rubric.length > 400 },
  // No FAIL picture: the judge gets a strict default and the rubric author never wrote one.
  { code: 'no-fail-picture', found: (c) => (c.fail ?? '').trim() === '' },
];

const NEGATION = /\b(not|no|never|cannot|without|fails? to|failing to)\b|n't\b/gi;
const negations = (sentence: string): number => (sentence.match(NEGATION) ?? []).length;
const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/);

/** Lists the defects of a criterion's rubric and pictures. A criterion without defects gives an empty list. */
export function lintCriterion(criterion: CriterionText): { issues: LintIssue[] } {
  return { issues: RULES.filter((rule) => rule.found(criterion)).map((rule) => ({ code: rule.code })) };
}
