import { describe, expect, it } from 'vitest';
import { createJevJudge, type JudgeRequest } from '../src/index';

const KEY = ['test', 'jev', 'key', '5d2b8f'].join('-');
const REQUEST: JudgeRequest = {
  answerContract: 'legacy',
  criterion: { name: 'c', rubric: 'The reply is polite.', pass: 'Polite.', fail: 'Rude.' },
  transcript: [{ role: 'agent', text: 'Good morning.' }],
};

async function send(env: Record<string, string>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const judge = createJevJudge({
    env,
    maxRetries: 0,
    fetch: async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      return new Response(JSON.stringify({ model: 'jev-latest', answers: { verdict: { noul: 0.9 } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  await judge.judge(REQUEST);
  return calls[0];
}

describe('the two Jev routes', () => {
  it('the gateway takes the key in the api-key header, at its own URL by default', async () => {
    const call = await send({ JEV_ROUTE: 'gateway', JEV_API_KEY: KEY });
    expect(call?.url).toBe('https://jev-gateway.nexus-orga.gpt.nexus/v1/systemone');
    expect(call?.headers['api-key']).toBe(KEY);
    expect(call?.headers.authorization).toBeUndefined();
  });
  it('the direct route takes a bearer token, at the TypeSafe URL by default', async () => {
    const call = await send({ JEV_ROUTE: 'typesafe', JEV_API_KEY: KEY });
    expect(call?.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(call?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call?.headers['api-key']).toBeUndefined();
  });
  it('JEV_URL overrides the default URL of a route', async () => {
    const call = await send({
      JEV_ROUTE: 'gateway',
      JEV_URL: 'https://jev.example.test/x',
      JEV_API_KEY: KEY,
    });
    expect(call?.url).toBe('https://jev.example.test/x');
  });
  it('without a route the URL is still required and the key is a bearer token', async () => {
    expect(() => createJevJudge({ env: { JEV_API_KEY: KEY } })).toThrow(/JEV_URL/);
    const call = await send({ JEV_URL: 'https://jev.example.test/y', JEV_API_KEY: KEY });
    expect(call?.headers.authorization).toBe(`Bearer ${KEY}`);
  });
});
