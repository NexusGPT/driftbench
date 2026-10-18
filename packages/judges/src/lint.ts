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
  {
    code: 'subjective',
    found: (c) =>
      /\b(good|appropriate|nice|reasonable|properly|adequate|helpful|polite|professional|friendly)\b/i.test(
        c.rubric,
      ),
  },
  // A quantity word that hides the count.
  {
    code: 'vague-quantity',
    found: (c) => /\b(some|several|many|often|usually|mostly|a few|most of the time)\b/i.test(c.rubric),
  },
  // Two negations in one sentence: the judge has to cancel them in its head.
  { code: 'double-negative', found: (c) => sentences(c.rubric).some((sentence) => negations(sentence) >= 2) },
  // Nothing a judge can read: no reply, agent, message, tool, call, order, customer, user, file or transcript.
  {
    code: 'no-observable',
    found: (c) =>
      !/\b(repl(y|ies)|agents?|assistants?|messages?|tools?|calls?|orders?|customers?|users?|files?|transcripts?)\b/i.test(
        c.rubric,
      ),
  },
  // Over 400 characters: the question is lost in the text.
  { code: 'too-long', found: (c) => c.rubric.length > 400 },
  // No FAIL picture: the judge gets a strict default and the rubric author never wrote one.
  { code: 'no-fail-picture', found: (c) => (c.fail ?? '').trim() === '' },
  // No PASS picture: the judge has nothing to hold the answer against.
  { code: 'no-pass-picture', found: (c) => (c.pass ?? '').trim() === '' },
  // The two pictures are one text, so they separate nothing.
  {
    code: 'same-pictures',
    found: (c) => foldText(c.pass) !== '' && foldText(c.pass) === foldText(c.fail),
  },
  // One picture is the other with "not": the pair says the same thing twice and separates nothing.
  {
    code: 'picture-contradicts-rubric',
    found: (c) => negationOnly(c.pass, c.fail) || negationOnly(c.fail, c.pass),
  },
  // A conversation criterion that judges one reply: the judge reads the whole conversation and the rubric points at a slice.
  {
    code: 'scope-mismatch',
    found: (c) =>
      (c.scope === 'conversation' && /\b(the last|this|that) reply\b/i.test(c.rubric)) ||
      (c.scope !== 'conversation' && /\b(the whole conversation|every turn)\b/i.test(c.rubric)),
  },
  // A slot nobody filled: {plan}, {{price}} or <customer name>.
  { code: 'placeholder', found: (c) => /\{[^{}\n]+\}|<[^<>\n]+>/.test(c.rubric) },
  // A quote opened and not closed: where the quoted text ends is a guess.
  {
    code: 'unbalanced-quotes',
    found: (c) =>
      (c.rubric.match(/"/g) ?? []).length % 2 === 1 ||
      (c.rubric.match(/\u201c/g) ?? []).length !== (c.rubric.match(/\u201d/g) ?? []).length,
  },
  // Nothing to answer.
  { code: 'empty-rubric', found: (c) => c.rubric.trim() === '' },
  // Two checks in one rubric: a pass on one and a fail on the other has no single answer.
  { code: 'compound', found: (c) => /\b(and also|as well as)\b/i.test(c.rubric) },
  // A hedge in the rubric or the PASS picture: the bar moves with the reader.
  {
    code: 'hedged',
    found: (c) => /\b(might|may|could|perhaps|possibly)\b/i.test(`${c.rubric}\n${c.pass ?? ''}`),
  },
  // The rubric tells the judge the verdict instead of asking a question.
  {
    code: 'instruction-to-judge',
    found: (c) =>
      /\b(answer|reply with|respond with)\s+(pass|fail)\b|\balways\s+(pass|fail)\b|\bmark\s+(it\s+)?as\s+(pass|passed|fail|failed)\b/i.test(
        c.rubric,
      ),
  },
  // The pictures sit under the wrong label: PASS describes a failure, or FAIL describes a pass.
  {
    code: 'pictures-swapped',
    found: (c) =>
      (/\b(fails?|failed|failing)\b/i.test(c.pass ?? '') &&
        !/\b(not|never)\s+(fails?|failed)\b/i.test(c.pass ?? '')) ||
      /\b(passes|passed|passing)\b/i.test(c.fail ?? ''),
  },
];

const countNot = (text: string): number => (text.match(/\bnot\b/gi) ?? []).length;
const withoutNot = (text: string): string =>
  foldText(text.replace(/\b(not|do|does|did)\b/gi, ' ').replace(/\bname\b|\bnames\b|\bnamed\b/gi, 'name'));

/** True when `b` is `a` with "not" added (the auxiliary verbs do, does and did are ignored). */
function negationOnly(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined || a.trim() === '' || b.trim() === '') return false;
  return countNot(b) > countNot(a) && withoutNot(a) === withoutNot(b);
}

const foldText = (text: string | undefined): string => (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

const NEGATION = /\b(not|no|never|cannot|without|fails? to|failing to)\b|n't\b/gi;
const negations = (sentence: string): number => (sentence.match(NEGATION) ?? []).length;
const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/);

/** Lists the defects of a criterion's rubric and pictures. A criterion without defects gives an empty list. */
export function lintCriterion(criterion: CriterionText): { issues: LintIssue[] } {
  return { issues: RULES.filter((rule) => rule.found(criterion)).map((rule) => ({ code: rule.code })) };
}
