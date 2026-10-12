import { describe, expect, it } from 'vitest';
import { FakeJudge } from '../src/clients/fake';
import { judgePairwise, pairwiseRequest, pairwiseTally } from '../src/pairwise';

const criterion = {
  name: 'helpful',
  rubric: 'The reply answers the customer question and says what happens next.',
};
const transcript = [{ role: 'user' as const, text: 'Is fiber available at 12 Main St?' }];

/** Picks the reply that holds the word GOOD: pass when reply A holds it, fail when reply B does. */
const prefersGood = (request: { transcript: readonly { text: string }[] }) => {
  const a = request.transcript.find((entry) => entry.text.startsWith('Reply A:'))?.text ?? '';
  const b = request.transcript.find((entry) => entry.text.startsWith('Reply B:'))?.text ?? '';
  if (a.includes('GOOD')) return { outcome: 'pass' as const, reasoning: 'A is good' };
  if (b.includes('GOOD')) return { outcome: 'fail' as const, reasoning: 'B is good' };
  return { outcome: 'inconclusive' as const, reasoning: 'neither is good' };
};

describe('pairwiseRequest', () => {
  it('shows both replies as labelled lines and asks which satisfies the criterion better', () => {
    const request = pairwiseRequest(criterion, transcript, 'Yes, fiber.', 'No.');
    expect(request.transcript.map((entry) => entry.text)).toEqual([
      'Is fiber available at 12 Main St?',
      'Reply A: Yes, fiber.',
      'Reply B: No.',
    ]);
    expect(request.criterion.rubric).toMatch(/A or B/);
    expect(request.criterion.pass).toMatch(/Reply A satisfies it better/);
    expect(request.criterion.fail).toMatch(/Reply B satisfies it better/);
  });
});

describe('judgePairwise', () => {
  it('chooses the first candidate when it is better in both orders', async () => {
    const judge = new FakeJudge('j', [prefersGood]);
    const verdict = await judgePairwise(judge, criterion, transcript, 'GOOD answer.', 'bad answer.');
    expect(verdict).toMatchObject({ choice: 'first', consistent: true, positionBias: false });
    expect(judge.requests).toHaveLength(2);
  });

  it('chooses the second candidate when the swapped order favours it in both orders', async () => {
    const judge = new FakeJudge('j', [prefersGood]);
    const verdict = await judgePairwise(judge, criterion, transcript, 'bad answer.', 'GOOD answer.');
    expect(verdict).toMatchObject({ choice: 'second', consistent: true, positionBias: false });
  });

  it('calls a judge that always answers pass a position bias, and a tie', async () => {
    const judge = new FakeJudge('j', [{ outcome: 'pass', reasoning: 'A reads better' }]);
    const verdict = await judgePairwise(judge, criterion, transcript, 'one.', 'two.');
    expect(verdict).toMatchObject({ choice: 'tie', consistent: false, positionBias: true });
  });

  it('a tie when neither reply is preferred in either order', async () => {
    const judge = new FakeJudge('j', [{ outcome: 'inconclusive', reasoning: 'no difference' }]);
    const verdict = await judgePairwise(judge, criterion, transcript, 'one.', 'two.');
    expect(verdict).toMatchObject({ choice: 'tie', consistent: true, positionBias: false });
  });

  it('a judge that gives no answer makes the call fail, not a tie', async () => {
    const judge = new FakeJudge('j', [new Error('transport down')]);
    await expect(judgePairwise(judge, criterion, transcript, 'one.', 'two.')).rejects.toThrow(
      /transport down/,
    );
  });
});

describe('pairwiseTally', () => {
  it('counts the choices, the inconsistent calls and the position biases', async () => {
    const judge = new FakeJudge('j', [prefersGood]);
    const verdicts = [
      await judgePairwise(judge, criterion, transcript, 'GOOD.', 'bad.'),
      await judgePairwise(judge, criterion, transcript, 'bad.', 'GOOD.'),
      await judgePairwise(judge, criterion, transcript, 'bad.', 'bad.'),
    ];
    expect(pairwiseTally(verdicts)).toEqual({
      first: 1,
      second: 1,
      tie: 1,
      inconsistent: 0,
      positionBias: 0,
    });
  });
});

describe('pairwise against a reference answer', () => {
  const reference = 'Acme Air 5G is available at 88 Summit Avenue for $35 a month.';

  it('puts the reference answer in every request and asks which reply matches it better', () => {
    const request = pairwiseRequest(criterion, transcript, 'one.', 'two.', reference);
    expect(request.transcript.map((entry) => entry.text)).toEqual([
      'Is fiber available at 12 Main St?',
      'Reply A: one.',
      'Reply B: two.',
      `Reference answer: ${reference}`,
    ]);
    expect(request.criterion.rubric).toMatch(/matches the reference answer/);
  });

  it('keeps the two orders, and calls a reply that matches the reference better the winner', async () => {
    const judge = new FakeJudge('j', [
      (request) => {
        const a = request.transcript.find((entry) => entry.text.startsWith('Reply A:'))?.text ?? '';
        return a.includes('Summit Avenue')
          ? { outcome: 'pass' as const, reasoning: 'A matches the reference' }
          : { outcome: 'fail' as const, reasoning: 'B matches the reference' };
      },
    ]);
    const verdict = await judgePairwise(
      judge,
      criterion,
      transcript,
      'Acme Air 5G at 88 Summit Avenue, $35.',
      'Fiber is not offered here.',
      { reference },
    );
    expect(verdict).toMatchObject({ choice: 'first', consistent: true, positionBias: false });
    expect(judge.requests).toHaveLength(2);
    expect(
      judge.requests.every((request) =>
        request.transcript.some((entry) => entry.text.startsWith('Reference answer:')),
      ),
    ).toBe(true);
  });
});

describe('the pairwise request carries its own comparison system prompt', () => {
  it('sets a system prompt for the comparison, and buildPrompt sends it instead of the criterion prompt', async () => {
    const { buildPrompt, SYSTEM_PROMPT } = await import('../src/index');
    const request = pairwiseRequest(criterion, transcript, 'one.', 'two.', 'reference text');
    expect(request.system).toBeDefined();
    expect(request.system).toMatch(/Reply A/);
    expect(request.system).toMatch(/reference/);
    expect(buildPrompt(request).system).toBe(request.system);
    expect(buildPrompt({ criterion, transcript }).system).toBe(SYSTEM_PROMPT);
  });
});

describe('bounded integrity retry', () => {
  it('re-asks an invalid model answer once, then maps the swapped winner correctly', async () => {
    const { parseJudgeText } = await import('../src/assessment');
    let calls = 0;
    const judge = {
      id: 'quote',
      family: 'test',
      cls: 'system2' as const,
      cost: 1,
      async judge(request: import('../src/contract').JudgeRequest) {
        calls += 1;
        const raw =
          calls === 1
            ? '{"reasoning":"B wins","winnerQuote":"bad","winner":"B"}'
            : calls === 2
              ? '{"reasoning":"B wins","winnerQuote":"GOOD","winner":"B"}'
              : '{"reasoning":"A wins","winnerQuote":"GOOD","winner":"A"}';
        return parseJudgeText(raw, request);
      },
    };
    const result = await judgePairwise(judge, criterion, transcript, 'bad', 'GOOD');
    expect(result.choice).toBe('second');
    expect(calls).toBe(3);
  });
  it('keeps a still-invalid answer inconclusive after one re-ask', async () => {
    let calls = 0;
    const judge = {
      id: 'broken',
      family: 'test',
      cls: 'system2' as const,
      cost: 1,
      async judge() {
        calls += 1;
        return { raw: '', unparsed: true, answer: { outcome: 'pass' as const, reasoning: 'invalid' } };
      },
    };
    const result = await judgePairwise(judge, criterion, transcript, 'one', 'two');
    expect(result.choice).toBe('tie');
    expect(result.positionBias).toBe(false);
    expect(calls).toBe(4);
  });
});

it('maps an explicitly named winner in code even for a custom client with a contradictory binary outcome', async () => {
  let calls = 0;
  const judge = {
    id: 'named',
    family: 'test',
    cls: 'system2' as const,
    cost: 1,
    async judge() {
      calls += 1;
      return {
        winner: calls === 1 ? ('B' as const) : ('A' as const),
        raw: '',
        answer: { outcome: 'pass' as const, reasoning: 'named winner' },
      };
    },
  };
  expect((await judgePairwise(judge, criterion, transcript, 'bad', 'good')).choice).toBe('second');
});
