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
  it('retries both concurrent initial 400s and omits temperature on later requests', async () => {
    const bodies: Record<string, unknown>[] = [];
    const initial: Array<(response: Response) => void> = [];
    const judge = createOpenAiJudge({
      env: { OPENAI_API_KEY: 'k', OPENAI_JUDGE_MODEL: 'm' },
      maxRetries: 0,
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        bodies.push(body);
        if ('temperature' in body) return new Promise<Response>((resolve) => initial.push(resolve));
        return new Response(JSON.stringify(OK), { status: 200 });
      },
    });
    const first = judge.judge(REQUEST);
    const second = judge.judge(REQUEST);
    expect(initial).toHaveLength(2);
    const rejected = () => new Response('{"error":{"message":"Unsupported temperature"}}', { status: 400 });
    initial[0]?.(rejected());
    expect((await first).answer.outcome).toBe('pass');
    initial[1]?.(rejected());
    expect((await second).answer.outcome).toBe('pass');
    await judge.judge(REQUEST);
    expect(bodies.map((body) => 'temperature' in body)).toEqual([true, true, false, false, false]);
  });

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

  it('openai: does not drop temperature on a 429 whose body quotes a 400 about it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const judge = createOpenAiJudge({
      env: { OPENAI_API_KEY: 'k', OPENAI_JUDGE_MODEL: 'm' },
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
