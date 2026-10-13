import { describe, expect, it } from 'vitest';
import { FakeJudge } from '../src/clients/fake';
import type { JudgeRequest } from '../src/contract';
import { withReferenceConsensus } from '../src/reference';

const request: JudgeRequest = {
  criterion: { name: 'correct', rubric: 'Correct final answer.' },
  transcript: [
    { role: 'user', text: '2+2?' },
    { role: 'agent', text: '5' },
  ],
};
describe('blind reference agreement gate', () => {
  it('supplies only the task to each solver and preserves missing attempts in the denominator', async () => {
    const seen: string[] = [];
    const answers = ['4', '4', '5', undefined, undefined];
    const judge = new FakeJudge('j', [{ outcome: 'fail', reasoning: 'wrong' }]);
    const wrapped = withReferenceConsensus(judge, {
      samples: 5,
      async solve(question) {
        seen.push(question);
        return { answer: answers.shift(), costUsd: 0.01 };
      },
    });
    const result = await wrapped.judge(request);
    expect(seen).toEqual(['2+2?', '2+2?', '2+2?', '2+2?', '2+2?']);
    expect(judge.requests[0]?.reference).toBeUndefined();
    expect(result.referenceAgreement?.used).toBe(false);
    expect(result.costUsd).toBeCloseTo(0.05);
  });
  it('injects only a strict agreed answer and never overrides an explicit caller reference', async () => {
    const judge = new FakeJudge('j', [{ outcome: 'pass', reasoning: 'ok' }]);
    let calls = 0;
    const wrapped = withReferenceConsensus(judge, {
      samples: 3,
      async solve() {
        calls += 1;
        return { answer: '4' };
      },
    });
    await wrapped.judge(request);
    expect(judge.requests[0]?.reference).toBe('4');
    await wrapped.judge({ ...request, reference: 'caller supplied' });
    expect(judge.requests[1]?.reference).toBe('caller supplied');
    expect(calls).toBe(3);
  });
});
