import { describe, expect, it } from 'vitest';
import type { DialectCompletion, DialectCompletionRequest, DialectTransport } from '../src/clients/transport';
import { type JudgeRequest, MAX_TOKENS, REASONING_TOKENS } from '../src/contract';
import { verifyAnswer } from '../src/verify-answer';

// A model that thinks by default spends its thinking from the same output limit as its answer.
const THINKING_ROOM = 16384;

const request: JudgeRequest = {
  criterion: { name: 'correct', rubric: 'The final answer is correct.' },
  transcript: [
    { role: 'user', text: 'What is 2 + 2?' },
    { role: 'agent', text: 'Final answer: 4' },
  ],
};
const pass = '{"pass":true,"reason":"The submitted answer is 4, which the remaining solve confirms."}';
const outOfRoom: Partial<DialectCompletion> = { text: '', truncated: true, finishReason: 'max_tokens' };

function transport(outputs: readonly (string | Partial<DialectCompletion> | Error)[]) {
  const seen: DialectCompletionRequest[] = [];
  const client: DialectTransport = {
    dialect: 'scratchpad-json',
    fingerprint: 'test',
    async complete(input) {
      seen.push(input);
      const output = outputs[seen.length - 1];
      if (output instanceof Error) throw output;
      if (output === undefined) throw new Error('unexpected call');
      return {
        dialect: 'scratchpad-json',
        fingerprint: 'test',
        raw: typeof output === 'string' ? output : 'provider raw',
        text: '',
        costUsd: 0.01,
        ...(typeof output === 'string' ? { text: output } : output),
      };
    },
  };
  return { client, seen };
}

describe('blind solves are evidence, not a precondition', () => {
  it('gives every verification stage thinking room when no reasoning level is set', async () => {
    const { client, seen } = transport(['Final answer: 4', 'Final answer: 4', 'Final answer: 4', pass]);
    expect((await verifyAnswer(client, request)).answer.outcome).toBe('pass');
    expect(seen.map((call) => call.maxTokens)).toEqual(Array(4).fill(THINKING_ROOM));
  });

  it('keeps the requested reasoning allowance when a reasoning level is set', async () => {
    const { client, seen } = transport(['Final answer: 4', 'Final answer: 4', 'Final answer: 4', pass]);
    await verifyAnswer(client, { ...request, reasoning: 'low' });
    expect(seen.map((call) => call.maxTokens)).toEqual(
      Array(4).fill(MAX_TOKENS.large + REASONING_TOKENS.low),
    );
  });

  it('drops a solve that runs out of output room and judges with the others', async () => {
    const { client, seen } = transport([outOfRoom, 'Final answer: 4', 'Final answer: 4', pass]);
    const result = await verifyAnswer(client, request);
    expect(result.answer.outcome).toBe('pass');
    expect(seen).toHaveLength(4);
    expect(seen[3]?.user).toContain('Independent solutions finished: 2 of 3.');
    const audit = JSON.parse(result.raw);
    expect(audit.finals).toEqual(['4', '4']);
    expect(audit.dropped).toEqual([{ solve: 1, reason: 'solve: incomplete or empty response' }]);
    expect(result.requestCount).toBe(4);
    expect(result.costUsd).toBeCloseTo(0.04);
  });

  it('drops a solve without an explicit final answer', async () => {
    const { client } = transport(['Working only.', 'Final answer: 4', 'Final answer: 4', pass]);
    const result = await verifyAnswer(client, request);
    expect(result.answer.outcome).toBe('pass');
    expect(JSON.parse(result.raw).dropped).toEqual([{ solve: 1, reason: 'no explicit final answer' }]);
  });

  it('lets the final check decide alone when no solve finishes', async () => {
    const { client, seen } = transport([
      outOfRoom,
      outOfRoom,
      outOfRoom,
      '{"pass":false,"reason":"Re-derived: 2 + 2 is 4, but the check finds the submitted 4 wrong."}',
    ]);
    const result = await verifyAnswer(client, request);
    expect(result.answer.outcome).toBe('fail');
    expect(seen).toHaveLength(4);
    expect(seen[3]?.user).toContain('Independent solutions finished: 0 of 3.');
    expect(seen[3]?.user).not.toContain('Independent solution 1:');
  });

  it('still ends inconclusive when the final check runs out of output room', async () => {
    const { client } = transport(['Final answer: 4', 'Final answer: 4', 'Final answer: 4', outOfRoom]);
    const result = await verifyAnswer(client, request);
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.answer.reasoning).toContain('compare: incomplete or empty response');
  });

  it('keeps a provider decline in a solve inconclusive, with the decline recorded', async () => {
    const { client } = transport([
      { text: 'I cannot help.', refusal: 'I cannot help.', declineReason: 'provider-blocked' },
    ]);
    const result = await verifyAnswer(client, request);
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.declineReason).toBe('provider-blocked');
  });

  it('keeps a transport failure in a solve inconclusive', async () => {
    const { client } = transport([new Error('fetch failed')]);
    const result = await verifyAnswer(client, request);
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.answer.reasoning).toContain('fetch failed');
  });
});

describe('review notes on dropped solves', () => {
  it('drops a solve whose client reports an output-limit failure', async () => {
    const limit = Object.assign(new Error('Claude exhausted its output budget before producing an answer'), {
      category: 'output-limit',
    });
    const { client } = transport([limit, 'Final answer: 4', 'Final answer: 4', pass]);
    const result = await verifyAnswer(client, request);
    expect(result.answer.outcome).toBe('pass');
    expect(JSON.parse(result.raw).dropped).toEqual([
      { solve: 1, reason: 'Claude exhausted its output budget before producing an answer' },
    ]);
  });

  it('keeps a dropped solve in the audit when a later solve is declined', async () => {
    const { client } = transport([
      outOfRoom,
      { text: 'I cannot help.', refusal: 'I cannot help.', declineReason: 'provider-blocked' },
    ]);
    const result = await verifyAnswer(client, request);
    expect(result.answer.outcome).toBe('inconclusive');
    expect(JSON.parse(result.raw).dropped).toEqual([
      { solve: 1, reason: 'solve: incomplete or empty response' },
    ]);
  });
});
