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
    const issues = lintCriterion({
      ...clean,
      rubric: 'Does the reply answer the question? Does it name Acme Care?',
    }).issues;
    expect(issues.map((i) => i.code)).toContain('two-questions');
    expect(lintCriterion({ ...clean, rubric: 'Does the reply name Acme Care?' }).issues).toEqual([]);
  });

  it('reports subjective when the rubric asks for a taste word, matched as a whole word without case', () => {
    for (const word of [
      'good',
      'Appropriate',
      'nice',
      'reasonable',
      'properly',
      'adequate',
      'helpful',
      'polite',
      'professional',
      'friendly',
    ]) {
      const issues = lintCriterion({ ...clean, rubric: `The reply is ${word} toward the customer.` }).issues;
      expect(issues.map((i) => i.code)).toContain('subjective');
    }
    expect(
      lintCriterion({ ...clean, rubric: 'The reply names Acme Care and its goodwill credit.' }).issues,
    ).toEqual([]);
  });

  it('reports vague-quantity for a word that hides how many', () => {
    for (const phrase of [
      'some',
      'several',
      'many',
      'often',
      'usually',
      'mostly',
      'a few',
      'Most of the time',
    ]) {
      const issues = lintCriterion({ ...clean, rubric: `The reply names Acme Care ${phrase} turns.` }).issues;
      expect(
        issues.map((i) => i.code),
        phrase,
      ).toContain('vague-quantity');
    }
    expect(lintCriterion({ ...clean, rubric: 'The reply names Acme Care in each reply.' }).issues).toEqual(
      [],
    );
  });

  it('reports double-negative when one sentence holds two negations', () => {
    for (const rubric of [
      'The reply does not fail to name Acme Care.',
      'The reply never leaves out no price.',
      "The reply doesn't omit the callback without a reason.",
    ]) {
      expect(
        lintCriterion({ ...clean, rubric }).issues.map((i) => i.code),
        rubric,
      ).toContain('double-negative');
    }
    expect(lintCriterion({ ...clean, rubric: 'The reply does not give legal advice.' }).issues).toEqual([]);
    expect(
      lintCriterion({ ...clean, rubric: 'The reply does not name a price. It never invents a plan.' }).issues,
    ).toEqual([]);
  });

  it('reports no-observable when the rubric names nothing a judge can read', () => {
    for (const rubric of [
      'Billing issues go to Acme Care.',
      'Prices are correct.',
      'Confirmation comes first.',
    ]) {
      expect(
        lintCriterion({ ...clean, rubric }).issues.map((i) => i.code),
        rubric,
      ).toContain('no-observable');
    }
    for (const rubric of [
      'The Replies name Acme Care.',
      'The agent names Acme Care.',
      'Each tool calls once.',
      'A file is written.',
    ]) {
      expect(
        lintCriterion({ ...clean, rubric }).issues.map((i) => i.code),
        rubric,
      ).not.toContain('no-observable');
    }
  });

  it('reports too-long for a rubric over 400 characters', () => {
    const base = 'The reply names Acme Care.';
    const long = `${base} ${'The reply keeps to the facts. '.repeat(14)}`.trimEnd();
    expect(long.length).toBeGreaterThan(400);
    expect(lintCriterion({ ...clean, rubric: long }).issues.map((i) => i.code)).toContain('too-long');
    expect(
      lintCriterion({ ...clean, rubric: `${base}${' reply'.repeat(62)}`.slice(0, 400) }).issues.map(
        (i) => i.code,
      ),
    ).not.toContain('too-long');
  });

  it('reports no-fail-picture when the FAIL picture is missing or blank', () => {
    const { fail: _fail, ...without } = clean;
    expect(lintCriterion(without).issues.map((i) => i.code)).toContain('no-fail-picture');
    expect(lintCriterion({ ...clean, fail: '  ' }).issues.map((i) => i.code)).toContain('no-fail-picture');
    expect(lintCriterion(clean).issues.map((i) => i.code)).not.toContain('no-fail-picture');
  });

  it('reports no-pass-picture when the PASS picture is missing or blank', () => {
    const { pass: _pass, ...without } = clean;
    expect(lintCriterion(without).issues.map((i) => i.code)).toContain('no-pass-picture');
    expect(lintCriterion({ ...clean, pass: '' }).issues.map((i) => i.code)).toContain('no-pass-picture');
    expect(lintCriterion(clean).issues.map((i) => i.code)).not.toContain('no-pass-picture');
  });

  it('reports same-pictures when both pictures are one text after folding case and spaces', () => {
    const same = lintCriterion({
      ...clean,
      pass: 'The reply does what the rubric asks.',
      fail: '  THE REPLY DOES   WHAT the rubric asks. ',
    });
    expect(same.issues.map((i) => i.code)).toContain('same-pictures');
    expect(lintCriterion(clean).issues.map((i) => i.code)).not.toContain('same-pictures');
    const blank = lintCriterion({ ...clean, pass: '', fail: '' }).issues.map((i) => i.code);
    expect(blank).not.toContain('same-pictures');
  });

  it('reports picture-contradicts-rubric when one picture is the other with "not"', () => {
    const pass = 'The reply does what the rubric asks.';
    for (const fail of [
      'The reply does not do what the rubric asks.',
      'The reply does not what the rubric asks.',
    ]) {
      expect(
        lintCriterion({ ...clean, pass, fail }).issues.map((i) => i.code),
        fail,
      ).toContain('picture-contradicts-rubric');
    }
    expect(
      lintCriterion({
        ...clean,
        pass: 'The reply names Acme Care.',
        fail: 'The reply does not name Acme Care.',
      }).issues.map((i) => i.code),
    ).toContain('picture-contradicts-rubric');
    expect(
      lintCriterion({ ...clean, pass, fail: 'The reply leaves out what the rubric asks.' }).issues.map(
        (i) => i.code,
      ),
    ).not.toContain('picture-contradicts-rubric');
  });

  it('reports scope-mismatch for a conversation criterion that speaks of the last reply', () => {
    const codes = (c: CriterionText) => lintCriterion(c).issues.map((i) => i.code);
    for (const rubric of [
      'In the last reply, the agent names Acme Care.',
      'This reply names Acme Care.',
      'The last reply names Acme Care.',
    ]) {
      expect(codes({ ...clean, rubric, scope: 'conversation' }), rubric).toContain('scope-mismatch');
      expect(codes({ ...clean, rubric, scope: 'block' }), rubric).not.toContain('scope-mismatch');
    }
    expect(codes({ ...clean, scope: 'conversation' })).not.toContain('scope-mismatch');
  });

  it('reports placeholder for an unfilled {braces} or <angle> slot', () => {
    for (const slot of ['{plan}', '<customer name>', '{{price}}']) {
      const rubric = `The reply names the plan for ${slot}.`;
      expect(
        lintCriterion({ ...clean, rubric }).issues.map((i) => i.code),
        slot,
      ).toContain('placeholder');
    }
    expect(
      lintCriterion({ ...clean, rubric: 'The reply says the price is under 5 and over 3 dollars.' }).issues,
    ).toEqual([]);
    expect(
      lintCriterion({ ...clean, rubric: 'The reply calls order.create when a < b holds.' }).issues,
    ).toEqual([]);
  });

  it('reports unbalanced-quotes when a double quote is opened and never closed', () => {
    const codes = (rubric: string) => lintCriterion({ ...clean, rubric }).issues.map((i) => i.code);
    expect(codes('The reply names Acme Care and says "Acme Care.')).toContain('unbalanced-quotes');
    expect(codes('The reply says \u201cAcme Care.')).toContain('unbalanced-quotes');
    expect(codes('The reply says "Acme Care" and "billing".')).not.toContain('unbalanced-quotes');
    expect(codes('The reply says \u201cAcme Care\u201d.')).not.toContain('unbalanced-quotes');
  });

  it('reports empty-rubric for a rubric of spaces only, and only that', () => {
    const codes = (rubric: string) => lintCriterion({ ...clean, rubric }).issues.map((i) => i.code);
    expect(codes('   ')).toContain('empty-rubric');
    expect(codes('')).toContain('empty-rubric');
    expect(codes('\n\t ')).toContain('empty-rubric');
    expect(codes(clean.rubric)).not.toContain('empty-rubric');
  });

  it('reports compound for two checks joined by "and also" or "as well as"', () => {
    const codes = (rubric: string) => lintCriterion({ ...clean, rubric }).issues.map((i) => i.code);
    expect(codes('The reply names Acme Care, and also the reply is under 80 words.')).toContain('compound');
    expect(codes('The reply names Acme Care as well as its phone line.')).toContain('compound');
    expect(codes('The reply names Acme Care and its phone line.')).not.toContain('compound');
  });

  it('reports hedged for might, may, could, perhaps, possibly in the rubric or the PASS picture', () => {
    const codes = (c: Partial<CriterionText>) => lintCriterion({ ...clean, ...c }).issues.map((i) => i.code);
    for (const word of ['might', 'may', 'could', 'Perhaps', 'possibly']) {
      expect(codes({ rubric: `The reply ${word} name Acme Care.` }), word).toContain('hedged');
    }
    expect(codes({ pass: 'The reply possibly names Acme Care.' })).toContain('hedged');
    expect(codes({ fail: 'The reply may leave out Acme Care.' })).not.toContain('hedged');
    expect(codes({ rubric: 'The reply names the May invoice.' })).toContain('hedged');
  });

  it('reports instruction-to-judge when the rubric tells the judge what to answer', () => {
    const codes = (rubric: string) => lintCriterion({ ...clean, rubric }).issues.map((i) => i.code);
    for (const tail of [
      'If unsure, answer pass.',
      'Always pass replies from Acme.',
      'Mark as passed when polite.',
      'ANSWER FAIL otherwise.',
    ]) {
      expect(codes(`The reply names Acme Care. ${tail}`), tail).toContain('instruction-to-judge');
    }
    expect(codes('The reply names Acme Care and the answer it gives is pass-through.')).not.toContain(
      'instruction-to-judge',
    );
    expect(codes('The reply marks the order as shipped.')).not.toContain('instruction-to-judge');
  });

  it('reports pictures-swapped when the PASS picture speaks of failing or the FAIL picture of passing', () => {
    const codes = (c: Partial<CriterionText>) => lintCriterion({ ...clean, ...c }).issues.map((i) => i.code);
    expect(
      codes({ pass: 'The reply fails to name Acme Care.', fail: 'The reply passes the check.' }),
    ).toContain('pictures-swapped');
    expect(codes({ pass: 'The reply fails to name Acme Care.' })).toContain('pictures-swapped');
    expect(codes({ fail: 'The reply passes the check.' })).toContain('pictures-swapped');
    expect(codes({})).not.toContain('pictures-swapped');
    expect(codes({ pass: 'The reply names Acme Care and the check passes.' })).not.toContain(
      'pictures-swapped',
    );
  });

  it('reports scope-mismatch for a block criterion that speaks of the whole conversation', () => {
    const codes = (rubric: string, scope: 'block' | 'conversation') =>
      lintCriterion({ ...clean, rubric, scope }).issues.map((i) => i.code);
    for (const rubric of [
      'Over the whole conversation, the reply names Acme Care.',
      'Every turn names Acme Care.',
    ]) {
      expect(codes(rubric, 'block'), rubric).toContain('scope-mismatch');
      expect(codes(rubric, 'conversation'), rubric).not.toContain('scope-mismatch');
    }
    expect(codes(clean.rubric, 'block')).not.toContain('scope-mismatch');
  });
});
