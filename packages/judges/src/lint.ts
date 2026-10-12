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
];

/** Lists the defects of a criterion's rubric and pictures. A criterion without defects gives an empty list. */
export function lintCriterion(criterion: CriterionText): { issues: LintIssue[] } {
  return { issues: RULES.filter((rule) => rule.found(criterion)).map((rule) => ({ code: rule.code })) };
}
