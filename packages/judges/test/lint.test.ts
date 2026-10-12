import { describe, expect, it } from 'vitest';
import { type CriterionText, lintCriterion } from '../src/index';

const clean: CriterionText = {
  name: 'one_question',
  rubric: 'The reply asks the customer at most one question.',
  pass: 'One question, or none.',
  fail: 'Two or more questions in the same reply.',
  scope: 'block',
};

describe('lintCriterion', () => {
  it('gives no issue for a rubric without a defect', () => {
    expect(lintCriterion(clean)).toEqual({ issues: [] });
  });

  it('reports two-questions when the rubric holds more than one question mark', () => {
    const issues = lintCriterion({ ...clean, rubric: 'Does the reply answer the question? Does it name Acme Care?' }).issues;
    expect(issues.map((i) => i.code)).toContain('two-questions');
    expect(lintCriterion({ ...clean, rubric: 'Does the reply name Acme Care?' }).issues).toEqual([]);
  });

  it('reports subjective when the rubric asks for a taste word, matched as a whole word without case', () => {
    for (const word of ['good', 'Appropriate', 'nice', 'reasonable', 'properly', 'adequate', 'helpful', 'polite', 'professional', 'friendly']) {
      const issues = lintCriterion({ ...clean, rubric: `The reply is ${word} toward the customer.` }).issues;
      expect(issues.map((i) => i.code)).toContain('subjective');
    }
    expect(lintCriterion({ ...clean, rubric: 'The reply names Acme Care and its goodwill credit.' }).issues).toEqual([]);
  });
});
