import { describe, expect, it } from 'vitest';
import type { DialectCompletionRequest, DialectTransport } from '../src/clients/transport';
import { type JudgeRequest, MAX_TOKENS, REASONING_TOKENS } from '../src/contract';
import { createDefaultJudge } from '../src/default-judge';
import { verifyAnswer } from '../src/verify-answer';

const request: JudgeRequest = {
  criterion: { name: 'correct', rubric: 'The answer is correct and includes the unit.' },
  transcript: [
    { role: 'user', text: 'What is the combined mass of two 2 kg weights?' },
    { role: 'agent', text: 'The combined mass is 4 kg.' },
  ],
};

// Without a reasoning level, verification stages also carry room for a model that thinks by default.
const THINKING_ROOM = MAX_TOKENS.large + 12288;

function boundedTransport(reasoning?: DialectTransport['reasoning'], requiredTokens = 2048) {
  const calls: DialectCompletionRequest[] = [];
  const transport: DialectTransport = {
    dialect: 'scratchpad-json',
    fingerprint: 'bounded-fixture',
    ...(reasoning === undefined ? {} : { reasoning }),
    async complete(input) {
      calls.push(input);
      const routing = input.system.startsWith('Select the evaluation procedure');
      const truncated = !routing && (input.maxTokens ?? MAX_TOKENS.normal) < requiredTokens;
      const text = routing
        ? '{"route":"objective"}'
        : truncated
          ? ''
          : input.system.startsWith('You locate')
            ? '4 kg'
            : input.system.startsWith('Solve the problem')
              ? 'The masses add. Final answer: 4 kg'
              : input.system.startsWith('Compare final answers')
                ? '{"same":[true,true,true]}'
                : input.system.startsWith('Decide whether')
                  ? '{"pass":true,"reason":"The sum and unit meet the complete criterion."}'
                  : '{"finals":["4 kg"],"committed":true}';
      return {
        text,
        raw: text,
        dialect: 'scratchpad-json',
        fingerprint: 'bounded-fixture',
        costUsd: 0.01,
        ...(truncated ? { truncated: true, finishReason: 'max_tokens' } : {}),
      };
    },
  };
  return { transport, calls };
}

describe('objective verification output room', () => {
  it('separates explicit output caps in recording identity and preserves omitted settings', () => {
    const { transport } = boundedTransport();
    const options = { provider: 'openai' as const, model: 'fixture', env: {}, transport };
    const implicit = createDefaultJudge(options);
    expect(createDefaultJudge({ ...options, maxTokens: undefined }).settings).toBe(implicit.settings);
    const small = createDefaultJudge({ ...options, maxTokens: 512 });
    const large = createDefaultJudge({ ...options, maxTokens: 8192 });
    expect(new Set([implicit.settings, small.settings, large.settings]).size).toBe(3);
  });

  it('completes every direct stage when the answer needs more than the normal allowance', async () => {
    const { transport, calls } = boundedTransport();
    const result = await verifyAnswer(transport, request);
    expect(result.answer.outcome).toBe('pass');
    expect(calls).toHaveLength(7);
    expect(calls.map((call) => call.maxTokens)).toEqual(Array(7).fill(THINKING_ROOM));
    expect(JSON.parse(result.raw)).toMatchObject({ version: 2 });
    expect(JSON.parse(result.raw).calls.map((call: { stage: string }) => call.stage)).toEqual([
      'extract',
      'solve',
      'solve',
      'solve',
      'match',
      'compare',
      'commit',
    ]);
    expect(result.requestCount).toBe(7);
    expect(result.costUsd).toBeCloseTo(0.07);
  });

  it.each([
    [undefined, 'high', 'high'],
    ['medium', undefined, 'medium'],
    ['high', 'low', 'low'],
  ] as const)(
    'adds reasoning room for transport %s and request %s',
    async (inherited, override, effective) => {
      const { transport, calls } = boundedTransport(inherited);
      const result = await verifyAnswer(transport, {
        ...request,
        ...(override ? { reasoning: override } : {}),
      });
      expect(result.answer.outcome).toBe('pass');
      expect(calls).toHaveLength(7);
      for (const call of calls) {
        expect(call.reasoning).toBe(effective);
        expect(call.maxTokens).toBe(MAX_TOKENS.large + REASONING_TOKENS[effective]);
      }
    },
  );

  it('gives the router its normal budget plus thinking room, and the routed verifier its procedure allowance', async () => {
    const { transport, calls } = boundedTransport();
    const judge = createDefaultJudge({ provider: 'openai', model: 'fixture', env: {}, transport });
    const result = await judge.judge(request);
    expect(result.answer.outcome).toBe('pass');
    expect(result.defaultJudge).toMatchObject({ version: 'default-on-v7', route: 'objective' });
    expect(calls.map((call) => call.maxTokens)).toEqual([
      MAX_TOKENS.normal + 12288,
      ...Array(7).fill(THINKING_ROOM),
    ]);
    expect(result.requestCount).toBe(8);
    expect(result.costUsd).toBeCloseTo(0.08);
  });

  it('propagates request reasoning through the factory and adds it once', async () => {
    const { transport, calls } = boundedTransport('high');
    const judge = createDefaultJudge({ provider: 'openai', model: 'fixture', env: {}, transport });
    expect((await judge.judge({ ...request, reasoning: 'low' })).answer.outcome).toBe('pass');
    expect(calls.every((call) => call.reasoning === 'low')).toBe(true);
    expect(calls.map((call) => call.maxTokens)).toEqual([
      MAX_TOKENS.normal + REASONING_TOKENS.low,
      ...Array(7).fill(MAX_TOKENS.large + REASONING_TOKENS.low),
    ]);
  });

  it.each([512, 8192])(
    'honors the explicit factory cap %i over procedure and reasoning allowances',
    async (maxTokens) => {
      const { transport, calls } = boundedTransport('high');
      const judge = createDefaultJudge({
        provider: 'openai',
        model: 'fixture',
        env: {},
        transport,
        maxTokens,
      });
      const result = await judge.judge({ ...request, reasoning: 'low' });
      expect(result.answer.outcome).toBe(maxTokens < 2048 ? 'inconclusive' : 'pass');
      expect(calls.every((call) => call.maxTokens === maxTokens)).toBe(true);
      expect(calls.every((call) => call.reasoning === 'low')).toBe(true);
    },
  );

  it('keeps an extraction that exhausts the thinking room inconclusive', async () => {
    const { transport, calls } = boundedTransport(undefined, THINKING_ROOM + 1);
    const result = await verifyAnswer(transport, request);
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.answer.reasoning).toContain('extract: incomplete or empty response');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.maxTokens).toBe(THINKING_ROOM);
    expect(JSON.parse(result.raw).calls[0].completion.truncated).toBe(true);
    expect(result.costUsd).toBe(0.01);
  });
});
