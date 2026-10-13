import { describe, expect, it } from 'vitest';
import { createOpenAiJudge, type JudgeRequest } from '../src/index';

const REQUEST: JudgeRequest = {
  criterion: { name: 'c', rubric: 'The reply is polite.' },
  transcript: [{ role: 'agent', text: 'Good morning.' }],
};
const OK = {
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: '{"checks":[{"id":"c","reasoning":"polite","evidence":"Good morning.","met":true}]}',
      },
    },
  ],
};

describe('the OpenAI client and a model that takes only the default temperature', () => {
  it('asks again without temperature after a 400 about it, and stops sending it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const judge = createOpenAiJudge({
      env: { OPENAI_API_KEY: 'k', OPENAI_JUDGE_MODEL: 'm' },
      maxRetries: 0,
      fetch: async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        if ('temperature' in body)
          return new Response(
            JSON.stringify({
              error: { message: "Unsupported value: 'temperature' does not support 0 with this model." },
            }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          );
        return new Response(JSON.stringify(OK), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const first = await judge.judge(REQUEST);
    expect(first.answer.outcome).toBe('pass');
    await judge.judge(REQUEST);
    expect(bodies.map((b) => 'temperature' in b)).toEqual([true, false, false]);
  });

  it('does not hide a 400 about something else', async () => {
    const judge = createOpenAiJudge({
      env: { OPENAI_API_KEY: 'k', OPENAI_JUDGE_MODEL: 'm' },
      maxRetries: 0,
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: 'bad schema' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    });
    await expect(judge.judge(REQUEST)).rejects.toThrow(/400/);
  });
});

describe('concurrent first requests to a model that takes only the default temperature', () => {
  it('retries every request that got the temperature 400, whatever the shared flag says by then', async () => {
    const judge = createOpenAiJudge({
      env: { OPENAI_API_KEY: 'k', OPENAI_JUDGE_MODEL: 'm' },
      maxRetries: 0,
      fetch: async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        // Every answer arrives only after all three requests are out, so the flag has flipped before the others fail.
        await new Promise((resolve) => setTimeout(resolve, 20));
        if ('temperature' in body)
          return new Response(
            JSON.stringify({
              error: { message: "Unsupported value: 'temperature' does not support 0 with this model." },
            }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          );
        return new Response(JSON.stringify(OK), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const results = await Promise.all([judge.judge(REQUEST), judge.judge(REQUEST), judge.judge(REQUEST)]);
    expect(results.map((r) => r.answer.outcome)).toEqual(['pass', 'pass', 'pass']);
  });
});
