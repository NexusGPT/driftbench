import { describe, expect, it } from 'vitest';
import { FakeJudge, type JudgeAnswer, type JudgeRequest, judgeRepeated } from '../src/index';

const request: JudgeRequest = {
  criterion: { name: 'c', rubric: 'r' },
  transcript: [{ role: 'user', text: 'hi' }],
};
const answer = (outcome: JudgeAnswer['outcome']): JudgeAnswer => ({ outcome, reasoning: 's' });

describe('judgeRepeated', () => {
  it('is consistent when all k outcomes are equal and decisive', async () => {
    const got = await judgeRepeated(new FakeJudge('a', [answer('pass')]), request, 5);
    expect(got).toEqual({ outcomes: ['pass', 'pass', 'pass', 'pass', 'pass'], consistent: true });
  });

  it('shows the flip and is not consistent', async () => {
    const answers = [answer('pass'), answer('pass'), answer('pass'), answer('fail'), answer('pass')];
    const got = await judgeRepeated(new FakeJudge('a', answers), request, 5);
    expect(got.consistent).toBe(false);
    expect(got.outcomes[3]).toBe('fail');
  });

  it('never calls a run of inconclusive answers consistent', async () => {
    expect((await judgeRepeated(new FakeJudge('a', [answer('inconclusive')]), request, 3)).consistent).toBe(
      false,
    );
  });

  it('refuses k that is not a whole number from 1', async () => {
    for (const k of [0, -1, 2.5, Number.NaN]) {
      await expect(judgeRepeated(new FakeJudge('a', [answer('pass')]), request, k)).rejects.toThrow(
        RangeError,
      );
    }
  });
});
