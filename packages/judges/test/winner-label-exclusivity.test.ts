import { describe, expect, it } from 'vitest';
import { type JudgeRequest, judgePairwise, parseJudgeText } from '../src/index';

describe('reply labels authenticate the winner without excluding the other candidate', () => {
  for (const first of [
    'Shared answer.',
    JSON.stringify({ text: 'Shared answer.' }),
    JSON.stringify('Shared answer.'),
  ]) {
    for (const winner of ['A', 'B'] as const) {
      it(`${winner} abstains when labelled content matches plain and ${first}`, () => {
        const request: JudgeRequest = {
          criterion: { name: 'c', rubric: 'r' },
          transcript: [],
          assessment: { kind: 'pairwise' },
          candidates: { A: first, B: 'Shared answer.' },
        };
        const result = parseJudgeText(
          JSON.stringify({ winner, winnerQuote: `Reply ${winner}: Shared answer.`, reasoning: 'r' }),
          request,
        );
        expect(result.unparsed).toBe(true);
        expect(result.answer.outcome).toBe('inconclusive');
        expect(result.answer.reasoning).toContain('your quote matches both replies');
      });
    }
  }
  it('rejects a label inconsistent with the declared winner before comparing either candidate', () => {
    const request: JudgeRequest = {
      criterion: { name: 'c', rubric: 'r' },
      transcript: [],
      assessment: { kind: 'pairwise' },
      candidates: { A: JSON.stringify({ text: 'Correct answer 42.' }), B: 'Wrong answer 41.' },
    };
    expect(
      parseJudgeText('{"winner":"A","winnerQuote":"Reply B: Correct answer 42.","reasoning":"r"}', request)
        .unparsed,
    ).toBe(true);
    expect(
      parseJudgeText('{"winner":"A","winnerQuote":"Reply A: Correct answer 42.","reasoning":"r"}', request)
        .winner,
    ).toBe('A');
  });
  it('re-asks once per order, then keeps identical replies as a tie', async () => {
    let calls = 0;
    const client = {
      id: 'label',
      family: 'fixture',
      cls: 'system2' as const,
      cost: 1,
      async judge(request: JudgeRequest) {
        const winner = ++calls % 2 ? 'A' : 'B';
        return parseJudgeText(
          JSON.stringify({ winner, winnerQuote: `Reply ${winner}: Shared answer.`, reasoning: 'r' }),
          request,
        );
      },
    };
    const result = await judgePairwise(
      client,
      { name: 'c', rubric: 'r' },
      [],
      'Shared answer.',
      'Shared answer.',
    );
    expect(result.choice).toBe('tie');
    expect(calls).toBe(4);
  });
});
