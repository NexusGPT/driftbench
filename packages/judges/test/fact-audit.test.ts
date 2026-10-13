import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import { type JudgeRequest, parseAnswerText } from '../src/contract';
import { judgePairwise, pairwiseRequest } from '../src/pairwise';
import fixture from './fixtures/audit-tie.json';

const criterion = { name: 'facts', rubric: 'Price, data and availability match the reference.' };
describe('audit and fact-ledger recovery', () => {
  it('ports the real four-call h058 recovery and computes the fallback winner in code', async () => {
    let calls = 0;
    const judge = {
      id: 'recorded',
      family: 'test',
      cls: 'system2' as const,
      cost: 1,
      async judge(request: JudgeRequest) {
        const call = fixture.calls[calls++];
        if (!call) throw new Error('unexpected extra call');
        return request.assessment?.kind === 'fact-ledger'
          ? parseJudgeText(call.text, request)
          : parseAnswerText(call.text);
      },
    };
    const result = await judgePairwise(
      judge,
      criterion,
      [{ role: 'user', text: fixture.item.task }],
      fixture.item.candidate_a,
      fixture.item.candidate_b,
      { reference: fixture.item.golden },
    );
    expect(result.choice).toBe('first');
    expect(result.recovered).toBe(true);
    expect(calls).toBe(4);
  });
  it('refuses duplicate facts and makes no winner from a malformed ledger', () => {
    const request: JudgeRequest = {
      ...pairwiseRequest(criterion, [], 'a', 'b', 'price 34 USD'),
      assessment: { kind: 'fact-ledger' },
    };
    const row = { fact: 'price', reference: 'price 34 USD', a: 'match', b: 'wrong' };
    expect(
      parseJudgeText(JSON.stringify({ facts: [row, row], unsupported_a: [], unsupported_b: [] }), request)
        .unparsed,
    ).toBe(true);
    expect(parseJudgeText('{}', request).answer.outcome).toBe('inconclusive');
  });
  it('counts requested facts before extras and handles units and negation as explicit statuses', () => {
    const request: JudgeRequest = {
      ...pairwiseRequest(criterion, [], 'a', 'b', 'price 34 USD; data 60 GB'),
      assessment: { kind: 'fact-ledger' },
    };
    const result = parseJudgeText(
      JSON.stringify({
        facts: [
          { fact: 'price', reference: 'price 34 USD', a: 'match', b: 'wrong' },
          { fact: 'data', reference: 'data 60 GB', a: 'wrong', b: 'wrong' },
        ],
        unsupported_a: ['extra 1', 'extra 2'],
        unsupported_b: [],
      }),
      request,
    );
    expect(result.answer.outcome).toBe('pass');
    expect(result.factLedger?.facts).toHaveLength(2);
  });
});
