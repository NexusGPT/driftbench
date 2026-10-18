import { describe, expect, it } from 'vitest';
import { parseJudgeText, responseSchema } from '../src/assessment';
import { type JudgeRequest, parseAnswerText } from '../src/contract';
import { buildPrompt } from '../src/prompt';
import fixture from './fixtures/pointwise-inversion.json';

const request: JudgeRequest = {
  criterion: { name: 'relevancy', rubric: 'The reply answers what the user asked.' },
  transcript: [
    { role: 'user', text: "Give Acme Cedar 4's price, not Amber's, and Acme Cedar 4's data allowance." },
    { role: 'agent', text: 'Acme Cedar 4 is $59 monthly and includes 78 GB.' },
  ],
};
describe('ordinary criteria default to an evidence ledger', () => {
  it('rejects the real inverted model answer without changing the public binary parser', () => {
    expect(parseAnswerText(fixture.result).answer.outcome).toBe('fail');
    expect(parseAnswerText(fixture.result).answer.reasoning).toContain('the outcome should be pass');
    expect(parseJudgeText(fixture.result, request).unparsed).toBe(true);
    expect(parseJudgeText(fixture.result, request).answer.outcome).toBe('inconclusive');
  });
  it('computes pass from grounded per-requirement facts, with no model verdict', () => {
    const result = parseJudgeText(
      JSON.stringify({
        checks: [
          {
            id: 'price',
            reasoning: 'The requested plan price is stated.',
            evidence: '$59 monthly',
            met: true,
          },
          {
            id: 'allowance',
            reasoning: 'The allowance is stated.',
            evidence: 'includes 78 GB',
            met: true,
          },
        ],
      }),
      {
        ...request,
        requirements: [
          { id: 'price', requirement: 'Answer the price.' },
          { id: 'allowance', requirement: 'Answer the allowance.' },
        ],
      },
    );
    expect(result.answer.outcome).toBe('pass');
    expect(result.checks).toHaveLength(2);
    expect(responseSchema(request).properties).toHaveProperty('checks');
    expect(buildPrompt(request).system).toContain('"checks"');
    expect(buildPrompt(request).system).not.toContain('"outcome"');
  });
  it('a false requirement decides fail; missing evidence cannot become a pass', () => {
    const raw = (met: boolean | null, evidence: string | null) =>
      JSON.stringify({ checks: [{ id: 'relevancy', reasoning: 'check', evidence, met }] });
    expect(parseJudgeText(raw(false, null), request).answer.outcome).toBe('fail');
    expect(parseJudgeText(raw(null, null), request).answer.outcome).toBe('inconclusive');
    expect(
      parseJudgeText(raw(true, 'invented quote'), { ...request, criterionDecoderVersion: 1 }).unparsed,
    ).toBe(true);
    expect(parseJudgeText(raw(true, 'invented quote'), request)).toMatchObject({
      answer: { outcome: 'pass' },
      evidenceUnverified: 1,
      checks: [{ met: true, evidence: null, grounded: false }],
    });
    expect(parseJudgeText(raw(true, null), request).unparsed).toBe(true);
    expect(parseJudgeText('{"checks":[]}', request).unparsed).toBe(true);
  });
});

it('the exact promptfoo factuality.006 inverted answer is rejected by the default and remains reproducible in legacy mode', async () => {
  const { default: factuality } = await import('./fixtures/factuality-inversion.json');
  expect(parseAnswerText(factuality.text).answer.reasoning).toContain('should pass');
  expect(parseJudgeText(factuality.text, request).unparsed).toBe(true);
  expect(parseJudgeText(factuality.text, { ...request, answerContract: 'legacy' }).answer.outcome).toBe(
    'fail',
  );
});

it('a selected legacy prompt is byte-for-byte the old recorded prompt', () => {
  const criterion = {
    name: 'relevancy',
    rubric:
      'The reply answers what the user asked in this turn, in any words. It does not answer a different question, change the subject, or ignore the ask. A short reply that fits the ask is relevant. A reply that restates the order the customer asked for and asks them to confirm it answers an order request.',
    fail: 'The reply answers a different question, changes the subject, or ignores the ask.',
    pass: 'The reply gives the answer the question needs, even when it does not repeat the question words. Restating the requested order and asking for confirmation is an answer to an order request.',
    scope: 'block' as const,
  };
  const prompt = buildPrompt({ ...request, criterion, answerContract: 'legacy' });
  expect(prompt.system).toBe(fixture.system);
  expect(prompt.user).toBe(fixture.user);
});
