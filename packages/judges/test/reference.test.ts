import { describe, expect, it, vi } from 'vitest';
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

describe('one blind reference', () => {
  it('accepts one solve, preserves its text, sums cost and leaves the verdict to the judge', async () => {
    const seen: JudgeRequest[] = [];
    const client = new FakeJudge('j', [{ outcome: 'fail', reasoning: 'still wrong' }]);
    const solve = vi.fn(async () => ({ answer: 'Work: 2 + 2 = 4.\nFinal answer: 4', costUsd: 0.02 }));
    const wrapped = withReferenceConsensus(
      {
        ...client,
        async judge(input) {
          seen.push(input);
          return { ...(await client.judge(input)), costUsd: 0.03 };
        },
      },
      { solve, samples: 1 },
    );
    const result = await wrapped.judge(request);
    expect(solve).toHaveBeenCalledExactlyOnceWith('2+2?', 0);
    expect(seen[0]?.reference).toBe('Work: 2 + 2 = 4.\nFinal answer: 4');
    expect(result.answer.outcome).toBe('fail');
    expect(result.costUsd).toBeCloseTo(0.05);
    expect(result.referenceAgreement).toEqual({ attempts: 1, agreement: 1, used: true });
  });

  it.each([undefined, '', '   '])('omits an empty solve (%j)', async (answer) => {
    const client = new FakeJudge('j', [{ outcome: 'inconclusive', reasoning: 'missing evidence' }]);
    const result = await withReferenceConsensus(client, {
      samples: 1,
      solve: async () => ({ answer, costUsd: 0.01 }),
    }).judge(request);
    expect(client.requests[0]).toBe(request);
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.costUsd).toBe(0.01);
    expect(result.referenceAgreement).toEqual({ attempts: 1, agreement: 0, used: false });
  });

  it('does not turn a thrown solve into a reference or a pass', async () => {
    const client = new FakeJudge('j', [{ outcome: 'fail', reasoning: 'wrong answer' }]);
    const result = await withReferenceConsensus(client, {
      samples: 1,
      solve: async () => {
        throw new Error('offline');
      },
    }).judge(request);
    expect(client.requests[0]).toBe(request);
    expect(result.answer.outcome).toBe('fail');
    expect(result.referenceAgreement).toEqual({ attempts: 1, agreement: 0, used: false });
  });

  it('does not change the five-solve default or relax disagreement', async () => {
    const solve = vi.fn(async (_question: string, i: number) => ({ answer: i < 3 ? '4' : '5' }));
    const client = new FakeJudge('j', [{ outcome: 'fail', reasoning: 'wrong' }]);
    const result = await withReferenceConsensus(client, { solve }).judge(request);
    expect(solve).toHaveBeenCalledTimes(5);
    expect(result.referenceAgreement).toEqual({ attempts: 5, agreement: 0.6, used: false });
    expect(client.requests[0]).toBe(request);
  });

  it.each([0, -1, 1.5, 21, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid sample count %s',
    (samples) => {
      expect(() =>
        withReferenceConsensus(new FakeJudge('j', ['bad']), {
          samples,
          solve: async () => ({ answer: '4' }),
        }),
      ).toThrow(RangeError);
    },
  );
});

describe('blind checkability routing', () => {
  it('skips solving creative requests while preserving the downstream judgement and route cost', async () => {
    const client = new FakeJudge('j', [{ outcome: 'pass', reasoning: 'good poem' }]);
    const solve = vi.fn(async () => ({ answer: 'not a reference' }));
    const creative: JudgeRequest = {
      ...request,
      transcript: [
        { role: 'user', text: 'Write a poem about rain.' },
        { role: 'agent', text: 'Rain sings.' },
      ],
    };
    const check = vi.fn(async () => ({ answer: 'NO', costUsd: 0.01 }));
    const result = await withReferenceConsensus(client, { solve, check, samples: 3, route: 'auto' }).judge(
      creative,
    );
    expect(check).toHaveBeenCalledExactlyOnceWith('Write a poem about rain.');
    expect(solve).not.toHaveBeenCalled();
    expect(client.requests).toEqual([creative]);
    expect(result.answer.outcome).toBe('pass');
    expect(result.costUsd).toBe(0.01);
    expect(result.referenceAgreement).toEqual({ attempts: 0, agreement: 0, used: false, routed: false });
  });

  it('asks the underlying client about the question alone by default', async () => {
    const client = new FakeJudge('j', [
      { outcome: 'pass', reasoning: 'YES' },
      { outcome: 'fail', reasoning: 'wrong answer' },
    ]);
    const solve = vi.fn(async () => ({ answer: '4' }));
    const privateRequest: JudgeRequest = {
      ...request,
      reference: undefined,
      system: 'secret system',
      artifact: 'secret artifact',
      inputs: [{ path: 'secret', text: 'private input' }],
      candidates: { A: 'secret A', B: 'secret B' },
      factAudit: { reference: 'secret truth' },
      assessment: { kind: 'pairwise' },
      given: { ledger: { label: 'secret label' } },
      transcript: [...request.transcript, { role: 'tool_result', text: 'secret tool' }],
    };
    const result = await withReferenceConsensus(client, { solve, samples: 1, route: 'auto' }).judge(
      privateRequest,
    );
    expect(client.requests).toHaveLength(2);
    const route = client.requests[0];
    expect(route?.transcript).toEqual([{ role: 'user', text: '2+2?' }]);
    expect(route?.criterion.rubric).toContain('one checkable correct answer');
    expect(JSON.stringify(route)).not.toMatch(/secret|private input/);
    expect(Object.keys(route ?? {}).sort()).toEqual(['criterion', 'transcript']);
    expect(solve).toHaveBeenCalledExactlyOnceWith('2+2?', 0);
    expect(client.requests[1]).toEqual({ ...privateRequest, reference: '4' });
    expect(result.referenceAgreement).toEqual({ attempts: 1, agreement: 1, used: true, routed: true });
    expect(result.answer.outcome).toBe('fail');
  });

  it('skips on a failed, unparsed or inconclusive route from the client', async () => {
    for (const route of [
      'invalid',
      { outcome: 'inconclusive' as const, reasoning: 'unknown' },
      { outcome: 'fail' as const, reasoning: 'NO' },
      new Error('offline'),
    ]) {
      const client = new FakeJudge('j', [route, { outcome: 'fail', reasoning: 'actual judgement' }]);
      const solve = vi.fn(async () => ({ answer: '4' }));
      const result = await withReferenceConsensus(client, { solve, samples: 1, route: 'auto' }).judge(
        request,
      );
      expect(solve).not.toHaveBeenCalled();
      expect(client.requests[1]).toBe(request);
      expect(result.answer.reasoning).toBe('actual judgement');
      expect(result.referenceAgreement?.routed).toBe(false);
    }
  });

  it.each(['NO', '', 'YES, maybe', 'not YES', undefined])(
    'never solves on an ambiguous check %j',
    async (answer) => {
      const client = new FakeJudge('j', [{ outcome: 'fail', reasoning: 'actual judgement' }]);
      const solve = vi.fn(async () => ({ answer: '4' }));
      const result = await withReferenceConsensus(client, {
        solve,
        samples: 1,
        route: 'auto',
        check: async () => ({ answer }),
      }).judge(request);
      expect(solve).not.toHaveBeenCalled();
      expect(client.requests[0]).toBe(request);
      expect(result.referenceAgreement?.routed).toBe(false);
    },
  );

  it('memoizes an in-flight route by exact question, without caching solves or counting the route cost twice', async () => {
    const client = new FakeJudge('j', [{ outcome: 'fail', reasoning: 'wrong' }]);
    let release: ((value: { answer: string; costUsd: number }) => void) | undefined;
    const check = vi.fn(
      () =>
        new Promise<{ answer: string; costUsd: number }>((resolve) => {
          release = resolve;
        }),
    );
    const solve = vi.fn(async () => ({ answer: '4', costUsd: 0.02 }));
    const wrapped = withReferenceConsensus(client, { solve, check, samples: 1, route: 'auto' });
    const first = wrapped.judge(request);
    const second = wrapped.judge({
      ...request,
      transcript: [
        { role: 'user', text: '2+2?' },
        { role: 'agent', text: '6' },
      ],
    });
    expect(check).toHaveBeenCalledTimes(1);
    release?.({ answer: ' yes ', costUsd: 0.01 });
    const results = await Promise.all([first, second]);
    expect(solve).toHaveBeenCalledTimes(2);
    expect(results.map((result) => result.referenceAgreement?.routed)).toEqual([true, true]);
    expect(results.reduce((sum, result) => sum + (result.costUsd ?? 0), 0)).toBeCloseTo(0.05);
    await wrapped.judge(request);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("keeps different questions and wrapper instances out of each other's cache", async () => {
    const check = vi.fn(async () => ({ answer: 'NO' }));
    const solve = vi.fn(async () => ({ answer: '4' }));
    const client = new FakeJudge('j', [{ outcome: 'fail', reasoning: 'wrong' }]);
    const options = { solve, check, samples: 1, route: 'auto' as const };
    const wrapped = withReferenceConsensus(client, options);
    await wrapped.judge(request);
    await wrapped.judge({ ...request, transcript: [{ role: 'user', text: '3+3?' }] });
    await withReferenceConsensus(client, options).judge(request);
    expect(check.mock.calls).toEqual([['2+2?'], ['3+3?'], ['2+2?']]);
  });

  it('preserves explicit references and bypasses empty questions without a route or solve', async () => {
    const check = vi.fn(async () => ({ answer: 'YES' }));
    const solve = vi.fn(async () => ({ answer: '4' }));
    const client = new FakeJudge('j', [{ outcome: 'fail', reasoning: 'wrong' }]);
    const wrapped = withReferenceConsensus(client, { solve, check, samples: 1, route: 'auto' });
    for (const input of [
      { ...request, reference: 'trusted' },
      { ...request, reference: '' },
      { ...request, transcript: [{ role: 'agent' as const, text: '5' }] },
    ]) {
      const result = await wrapped.judge(input);
      expect(result.referenceAgreement).toBeUndefined();
      expect(client.requests.at(-1)).toBe(input);
    }
    expect(check).not.toHaveBeenCalled();
    expect(solve).not.toHaveBeenCalled();
  });

  it('retains a failed solve as one attempt after a positive route', async () => {
    const client = new FakeJudge('j', [{ outcome: 'inconclusive', reasoning: 'unknown' }]);
    const result = await withReferenceConsensus(client, {
      samples: 1,
      route: 'auto',
      check: async () => ({ answer: 'YES', costUsd: 0.01 }),
      solve: async () => {
        throw new Error('no answer');
      },
    }).judge(request);
    expect(client.requests[0]).toBe(request);
    expect(result.referenceAgreement).toEqual({ attempts: 1, agreement: 0, used: false, routed: true });
    expect(result.costUsd).toBe(0.01);
  });

  it('includes the default route, solve and final judgement costs', async () => {
    const fake = new FakeJudge('j', [
      { outcome: 'pass', reasoning: 'checkable' },
      { outcome: 'fail', reasoning: 'wrong answer' },
    ]);
    const client = {
      ...fake,
      async judge(input: JudgeRequest) {
        return { ...(await fake.judge(input)), costUsd: 0.01 };
      },
    };
    const result = await withReferenceConsensus(client, {
      route: 'auto',
      samples: 1,
      solve: async () => ({ answer: '4', costUsd: 0.02 }),
    }).judge(request);
    expect(result.costUsd).toBeCloseTo(0.04);
  });

  it('caches a thrown route without stopping the actual judgement', async () => {
    const check = vi.fn(async () => {
      throw new Error('offline');
    });
    const solve = vi.fn(async () => ({ answer: '4' }));
    const client = new FakeJudge('j', [{ outcome: 'fail', reasoning: 'wrong' }]);
    const wrapped = withReferenceConsensus(client, { route: 'auto', samples: 1, solve, check });
    await wrapped.judge(request);
    const result = await wrapped.judge(request);
    expect(check).toHaveBeenCalledTimes(1);
    expect(solve).not.toHaveBeenCalled();
    expect(client.requests).toEqual([request, request]);
    expect(result.referenceAgreement?.routed).toBe(false);
  });

  it.each([-0.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses an invalid route cost %s',
    async (costUsd) => {
      const client = new FakeJudge('j', [{ outcome: 'fail', reasoning: 'wrong' }]);
      const solve = vi.fn(async () => ({ answer: '4' }));
      const result = await withReferenceConsensus(client, {
        solve,
        route: 'auto',
        samples: 1,
        check: async () => ({ answer: 'YES', costUsd }),
      }).judge(request);
      expect(solve).not.toHaveBeenCalled();
      expect(result.costUsd).toBeUndefined();
      expect(result.referenceAgreement?.routed).toBe(false);
    },
  );
});
