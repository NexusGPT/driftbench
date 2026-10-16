import { describe, expect, it } from 'vitest';
import type { DialectCompletionRequest, DialectTransport } from '../src/clients/transport';
import { type JudgeRequest, MAX_TOKENS, REASONING_TOKENS } from '../src/contract';
import { createDefaultJudge } from '../src/default-judge';

// A model that thinks by default spends its thinking from the same output limit as its answer.
const ROOM = 12288;

const pointwise: JudgeRequest = {
  criterion: { name: 'polite', rubric: 'The reply is polite.' },
  transcript: [
    { role: 'user', text: 'Say hello.' },
    { role: 'agent', text: 'Hello, nice to meet you.' },
  ],
};

function scripted(route: string, routeText?: string) {
  const calls: DialectCompletionRequest[] = [];
  const transport: DialectTransport = {
    dialect: 'scratchpad-json',
    fingerprint: 'robustness-fixture',
    async complete(input) {
      calls.push(input);
      const routing = input.system.startsWith('Select the evaluation procedure');
      const text = routing
        ? (routeText ?? `{"route":"${route}"}`)
        : JSON.stringify({
            checks: [
              {
                id: 'polite',
                reasoning: 'The reply greets the user kindly.',
                evidence: [{ source: 'transcript.1', quote: 'Hello, nice to meet you.' }],
                met: true,
              },
            ],
          });
      return {
        text,
        raw: text,
        dialect: 'scratchpad-json',
        fingerprint: 'robustness-fixture',
        costUsd: 0.001,
      };
    },
  };
  return { transport, calls };
}

describe('every default-policy stage has thinking room', () => {
  it('gives the router and the criterion reader room when no reasoning level is set', async () => {
    const { transport, calls } = scripted('criterion');
    const judge = createDefaultJudge({ provider: 'openai', model: 'fixture', env: {}, transport });
    expect((await judge.judge(pointwise)).answer.outcome).toBe('pass');
    expect(calls.map((call) => call.maxTokens)).toEqual([MAX_TOKENS.normal + ROOM, MAX_TOKENS.normal + ROOM]);
  });

  it('keeps the requested reasoning allowance when a reasoning level is set', async () => {
    const { transport, calls } = scripted('criterion');
    const judge = createDefaultJudge({ provider: 'openai', model: 'fixture', env: {}, transport });
    await judge.judge({ ...pointwise, reasoning: 'medium' });
    expect(calls.every((call) => call.maxTokens === MAX_TOKENS.normal + REASONING_TOKENS.medium)).toBe(true);
  });

  it('honors an explicit client output cap over the thinking room', async () => {
    const { transport, calls } = scripted('criterion');
    const judge = createDefaultJudge({
      provider: 'openai',
      model: 'fixture',
      env: {},
      transport,
      maxTokens: 2048,
    });
    await judge.judge(pointwise);
    expect(calls.every((call) => call.maxTokens === 2048)).toBe(true);
  });
});

describe('the router reads its final route object', () => {
  it('keeps the final route when the routing rationale quotes unbalanced braces', async () => {
    const { transport } = scripted(
      'unused',
      'The input `{ < { } > { (` has one correct completion, `) }`, so the answer is objectively checkable.\n\n{"route":"relevance"}',
    );
    const judge = createDefaultJudge({ provider: 'openai', model: 'fixture', env: {}, transport });
    const result = await judge.judge(pointwise);
    expect(result.defaultJudge).toMatchObject({ route: 'relevance' });
  });

  it('routes to the final object even after an earlier route-shaped example', async () => {
    const { transport } = scripted(
      'unused',
      'Returning {"route":"objective"} would need a verifiable answer, and politeness has none. So: {"route":"relevance"}',
    );
    const judge = createDefaultJudge({ provider: 'openai', model: 'fixture', env: {}, transport });
    expect((await judge.judge(pointwise)).defaultJudge).toMatchObject({ route: 'relevance' });
  });

  it('falls back to the criterion route when the final object names no known route', async () => {
    const { transport } = scripted('unused', 'Unsure. {"route":"poetry"}');
    const judge = createDefaultJudge({ provider: 'openai', model: 'fixture', env: {}, transport });
    expect((await judge.judge(pointwise)).defaultJudge).toMatchObject({ route: 'criterion' });
  });
});

describe('the final route object, whatever its key order', () => {
  it('reads a route that is not the first key', async () => {
    const { transport } = scripted(
      'unused',
      'Decided. {"why":"only relevance is asked","route":"relevance"}',
    );
    const judge = createDefaultJudge({ provider: 'openai', model: 'fixture', env: {}, transport });
    expect((await judge.judge(pointwise)).defaultJudge).toMatchObject({ route: 'relevance' });
  });

  it('falls back to the criterion route on a repeated route key', async () => {
    const { transport } = scripted('unused', '{"route":"relevance","route":"objective"}');
    const judge = createDefaultJudge({ provider: 'openai', model: 'fixture', env: {}, transport });
    expect((await judge.judge(pointwise)).defaultJudge).toMatchObject({ route: 'criterion' });
  });
});
