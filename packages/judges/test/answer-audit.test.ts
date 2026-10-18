import { describe, expect, it } from 'vitest';
import {
  ANSWER_AUDIT_PROMPT_FINGERPRINT,
  ANSWER_AUDIT_SYSTEM_PROMPT,
  AnswerAudit,
  buildPrompt,
  FakeJudge,
  type JudgeClient,
  type JudgeRequest,
  judgeAnswerAudit,
  PROMPT_FINGERPRINT,
  parseJudgeText,
  parseJudgeValue,
  requestKey,
  responseSchema,
} from '../src/index';

const answer = 'Aster costs 34 crowns monthly and includes 60 GB.';
const base: JudgeRequest = {
  criterion: {
    name: 'plan_terms',
    rubric: 'Does the reply state the monthly price and the data allowance of Aster?',
    pass: 'Both facts are present and correct.',
    fail: 'A fact is wrong or missing.',
  },
  transcript: [
    { role: 'user', text: 'State the price and data allowance of Aster.' },
    { role: 'agent', text: `[context] Background note.\n${answer}` },
  ],
};
const request: JudgeRequest = { ...base, assessment: { kind: 'answer-audit' } };
const check = (status: string, evidence = answer, condition = 'price stated') => ({
  condition,
  evidence,
  reasoning: 'The reply is compared with the criterion.',
  status,
});
const parse = (checks: unknown[], input = request) => parseJudgeText(JSON.stringify({ checks }), input);

describe('answer audit prompt', () => {
  it('sends role-separated JSON under its own system prompt and fingerprint', () => {
    const prompt = buildPrompt({ ...request, reference: 'Aster: 34 crowns monthly, 60 GB.' });
    expect(prompt.system).toBe(ANSWER_AUDIT_SYSTEM_PROMPT);
    expect(JSON.parse(prompt.user)).toEqual({
      criterion: {
        question: base.criterion.rubric,
        pass: base.criterion.pass,
        fail: base.criterion.fail,
      },
      reference: 'Aster: 34 crowns monthly, 60 GB.',
      transcript: base.transcript,
    });
    expect(ANSWER_AUDIT_PROMPT_FINGERPRINT).not.toBe(PROMPT_FINGERPRINT);
    expect(responseSchema(request)).toMatchObject({ required: ['checks'] });
  });

  it('leaves the default prompt and its cassette key untouched', () => {
    expect(buildPrompt(base).system).not.toBe(ANSWER_AUDIT_SYSTEM_PROMPT);
    expect(requestKey(request)).not.toBe(requestKey(base));
    expect(requestKey(base)).toBe(requestKey({ ...base }));
  });

  it('states a block scope only when the criterion asks for it', () => {
    const scoped = buildPrompt({ ...request, criterion: { ...base.criterion, scope: 'block' } });
    expect(JSON.parse(scoped.user).criterion.scope).toBe('the last agent turn; earlier entries are context');
    expect(JSON.parse(buildPrompt(request).user).criterion.scope).toBeUndefined();
  });

  it('refuses requests the payload cannot carry, before any call', () => {
    expect(() => buildPrompt({ ...request, given: { stage: 'offer' } })).toThrow(/request\.given/);
    expect(() => buildPrompt({ ...request, system: 'Be lenient.' })).toThrow(/request\.system/);
    expect(() => buildPrompt({ ...request, answerContract: 'legacy' })).toThrow(/legacy/);
    expect(() => buildPrompt({ ...request, reference: '  ' })).toThrow(/nonempty reference/);
    expect(() =>
      buildPrompt({ ...request, transcript: [{ role: 'user', text: 'Only a question.' }] }),
    ).toThrow(/needs a submission/);
  });
});

describe('answer audit verdict', () => {
  it('computes the outcome from condition statuses', () => {
    expect(parse([check('satisfied')]).answer.outcome).toBe('pass');
    expect(parse([check('satisfied'), check('violated', answer, 'allowance')]).answer.outcome).toBe('fail');
    expect(parse([check('satisfied'), check('missing', '', 'allowance')]).answer.outcome).toBe('fail');
    expect(parse([check('satisfied'), check('unknown', '', 'allowance')]).answer.outcome).toBe(
      'inconclusive',
    );
    expect(parse([check('violated'), check('unknown', '', 'allowance')]).answer.outcome).toBe('fail');
  });

  it('keeps the validated checks and the deciding quote', () => {
    const result = parse([check('satisfied'), check('violated', '60 GB', 'allowance')]);
    expect(result.unparsed).toBeUndefined();
    expect(result.answerAudit?.checks).toHaveLength(2);
    expect(result.answer.evidence).toBe('60 GB');
    expect(parseJudgeValue({ checks: [check('satisfied')] }, request).answer.outcome).toBe('pass');
  });

  it('rejects invented quotes, unquoted decisions, duplicate conditions and a model verdict', () => {
    for (const checks of [
      [check('satisfied', 'Aster costs 35 crowns monthly')],
      [check('satisfied', '')],
      [check('violated', '')],
      [check('satisfied'), check('satisfied', answer, 'Price  Stated')],
      [],
    ]) {
      const result = parse(checks);
      expect(result.unparsed).toBe(true);
      expect(result.answer.outcome).toBe('inconclusive');
      expect(result.answer.reasoning).toMatch(/^answer breaks the assessment contract: /);
    }
    expect(parseJudgeText('{"outcome":"pass","reasoning":"fine"}', request).unparsed).toBe(true);
    expect(
      parseJudgeText(JSON.stringify({ checks: [check('satisfied')], outcome: 'pass' }), request).unparsed,
    ).toBe(true);
  });

  it('never grounds a quote in the criterion or the reference', () => {
    const referenced: JudgeRequest = { ...request, reference: 'The plan is named Aster Prime.' };
    expect(parse([check('satisfied', 'Aster Prime')], referenced).unparsed).toBe(true);
    expect(parse([check('satisfied', 'monthly price and the data allowance')]).unparsed).toBe(true);
  });

  it('grounds a quote in a task entry or the artifact', () => {
    const filed: JudgeRequest = { ...request, artifact: 'Sheet row 2: Aster | 34 | 60 GB' };
    expect(parse([check('satisfied', 'Aster | 34 | 60 GB')], filed).answer.outcome).toBe('pass');
    expect(parse([check('satisfied', 'State the price and data allowance')]).answer.outcome).toBe('pass');
  });

  it('accepts the schema it publishes', () => {
    expect(AnswerAudit.safeParse({ checks: [check('satisfied')] }).success).toBe(true);
    expect(AnswerAudit.safeParse({ checks: [check('pass')] }).success).toBe(false);
  });
});

describe('judgeAnswerAudit', () => {
  const scripted = (texts: string[]) => {
    const requests: JudgeRequest[] = [];
    const client: JudgeClient = {
      id: 'audit',
      family: 'fake',
      cls: 'system2',
      cost: 1,
      async judge(asked) {
        requests.push(asked);
        return parseJudgeText(texts[Math.min(requests.length, texts.length) - 1] as string, asked);
      },
    };
    return { client, requests };
  };
  const good = JSON.stringify({ checks: [check('satisfied')] });

  it('asks once when the audit is valid and once more when it is not', async () => {
    const once = scripted([good]);
    expect((await judgeAnswerAudit(once.client, base)).answer.outcome).toBe('pass');
    expect(once.requests).toHaveLength(1);
    expect(once.requests[0]?.assessment).toEqual({ kind: 'answer-audit' });

    const twice = scripted(['{"checks":[]}', good]);
    expect((await judgeAnswerAudit(twice.client, base)).answer.outcome).toBe('pass');
    expect(twice.requests).toHaveLength(2);
    expect(twice.requests[1]?.budget).toBe('large');
  });

  it('refuses a probability judge and a competing assessment', async () => {
    await expect(judgeAnswerAudit(new FakeJudge('p', ['{}']), base)).rejects.toThrow(/system 2/);
    await expect(
      judgeAnswerAudit(scripted([good]).client, { ...base, assessment: { kind: 'pairwise' } }),
    ).rejects.toThrow(/cannot replace/);
  });
});
