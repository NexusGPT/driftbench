import { describe, expect, it } from 'vitest';
import { createAnthropicJudge, type JudgeRequest } from '../src/index';

const REQUEST: JudgeRequest = {
  criterion: { name: 'c', rubric: 'The reply is polite.' },
  transcript: [{ role: 'agent', text: 'Good morning.' }],
};
const OK = {
  stop_reason: 'end_turn',
  content: [
    {
      type: 'text',
      text: '{"checks":[{"id":"c","reasoning":"polite","evidence":"Good morning.","met":true}]}',
    },
  ],
};
const ENV = { ANTHROPIC_API_KEY: 'k', ANTHROPIC_JUDGE_MODEL: 'claude-haiku-5-5' };
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the Anthropic client and a model that refuses the temperature field', () => {
  it('asks again without temperature after a 400 about it, and stops sending it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const judge = createAnthropicJudge({
      env: ENV,
      maxRetries: 0,
      fetch: async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        if ('temperature' in body)
          return json(
            {
              type: 'error',
              error: {
                type: 'invalid_request_error',
                message: 'temperature is not supported for this model.',
              },
            },
            400,
          );
        return json(OK, 200);
      },
    });
    expect((await judge.judge(REQUEST)).answer.outcome).toBe('pass');
    await judge.judge(REQUEST);
    expect(bodies.map((b) => 'temperature' in b)).toEqual([true, false, false]);
  });

  it('keeps temperature 0 for a model that takes it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const judge = createAnthropicJudge({
      env: ENV,
      maxRetries: 0,
      fetch: async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return json(OK, 200);
      },
    });
    await judge.judge(REQUEST);
    expect(bodies.map((b) => b.temperature)).toEqual([0]);
  });

  it('anthropic: does not drop temperature on a 429 whose body quotes a 400 about it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const judge = createAnthropicJudge({
      env: ENV,
      maxRetries: 0,
      fetch: async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({ error: { message: 'upstream answered 400: temperature unsupported' } }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    await expect(judge.judge(REQUEST)).rejects.toThrow(/429/);
    await expect(judge.judge(REQUEST)).rejects.toThrow(/429/);
    expect(bodies.map((b) => 'temperature' in b)).toEqual([true, true]);
  });

  it('does not hide a 400 about something else', async () => {
    const judge = createAnthropicJudge({
      env: ENV,
      maxRetries: 0,
      fetch: async () => json({ type: 'error', error: { message: 'max_tokens is too large' } }, 400),
    });
    await expect(judge.judge(REQUEST)).rejects.toThrow(/400/);
  });
});
