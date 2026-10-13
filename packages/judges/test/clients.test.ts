import { collectRetries } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import {
  createAnthropicJudge,
  createGoogleJudge,
  createHttpJudge,
  createJevJudge,
  createOpenAiDecisionsJudge,
  createOpenAiJudge,
  type FetchLike,
  type JudgeClient,
  JudgeError,
  type JudgeRequest,
  postJson,
} from '../src/index';

/** Built at run time so no source file holds anything shaped like a key. */
const KEY = ['test', 'judge', 'key', '7f3a9c2e5b1d'].join('-');

const REQUEST: JudgeRequest = {
  answerContract: 'legacy',
  criterion: {
    name: 'one_question_per_turn',
    rubric: 'The reply asks the customer at most one question.',
    pass: 'One question, or none.',
    fail: 'Two or more questions in the same reply.',
  },
  transcript: [
    { role: 'user', text: 'What faster plans do you have?' },
    { role: 'agent', text: 'Which address is it for? And do you want fiber?' },
  ],
};

type Call = { url: string; headers: Record<string, string>; body: unknown };

/** A fetch that answers from a list of (status, body) pairs and records every call. */
function fakeFetch(replies: Array<[number, unknown] | [number, unknown, Record<string, string>]>): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    const [status, body, headers] = replies[Math.min(calls.length - 1, replies.length - 1)] as [
      number,
      unknown,
      Record<string, string> | undefined,
    ];
    if (body instanceof Error) throw body;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      ...(headers ? { headers } : {}),
    });
  };
  return { fetch, calls };
}

const noWait = async () => {};
const ANSWER =
  '{"outcome":"fail","score":0.05,"reasoning":"Two questions.","evidence":"And do you want fiber?"}';

type Case = {
  name: string;
  make: (fetch: FetchLike, env: Record<string, string>) => JudgeClient;
  env: Record<string, string>;
  missing: string;
  ok: unknown;
  url: string;
  keyHeader: [string, string];
  family: string;
  cls: 'system1' | 'system2';
};

const CASES: Case[] = [
  {
    name: 'openai',
    make: (fetch, env) => createOpenAiJudge({ fetch, env, sleep: noWait }),
    env: { OPENAI_API_KEY: KEY, OPENAI_JUDGE_MODEL: 'gpt-judge-test' },
    missing: 'OPENAI_API_KEY',
    ok: { choices: [{ finish_reason: 'stop', message: { content: ANSWER } }] },
    url: 'https://api.openai.com/v1/chat/completions',
    keyHeader: ['authorization', `Bearer ${KEY}`],
    family: 'openai',
    cls: 'system2',
  },
  {
    name: 'anthropic',
    make: (fetch, env) => createAnthropicJudge({ fetch, env, sleep: noWait }),
    env: { ANTHROPIC_API_KEY: KEY, ANTHROPIC_JUDGE_MODEL: 'claude-judge-test' },
    missing: 'ANTHROPIC_API_KEY',
    ok: { stop_reason: 'end_turn', content: [{ type: 'text', text: ANSWER }] },
    url: 'https://api.anthropic.com/v1/messages',
    keyHeader: ['x-api-key', KEY],
    family: 'anthropic',
    cls: 'system2',
  },
  {
    name: 'google',
    make: (fetch, env) => createGoogleJudge({ fetch, env, sleep: noWait }),
    env: { GEMINI_API_KEY: KEY, GOOGLE_JUDGE_MODEL: 'gemini-judge-test' },
    missing: 'GEMINI_API_KEY',
    ok: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: ANSWER }] } }] },
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-judge-test:generateContent',
    keyHeader: ['x-goog-api-key', KEY],
    family: 'google',
    cls: 'system2',
  },
  {
    name: 'jev',
    make: (fetch, env) => createJevJudge({ fetch, env, sleep: noWait }),
    env: { JEV_URL: 'https://jev.example.test/v1/decide', JEV_API_KEY: KEY },
    missing: 'JEV_URL',
    ok: { model: 'jev-latest', answers: { verdict: { noul: 0.05 } } },
    url: 'https://jev.example.test/v1/decide',
    keyHeader: ['authorization', `Bearer ${KEY}`],
    family: 'jev',
    cls: 'system1',
  },
  {
    name: 'openai-decisions',
    make: (fetch, env) => createOpenAiDecisionsJudge({ fetch, env, sleep: noWait }),
    env: { OPENAI_API_KEY: KEY, OPENAI_DECISIONS_MODEL: 'decisions-test' },
    missing: 'OPENAI_API_KEY',
    ok: { answers: [{ name: 'verdict', probability: 0.05 }] },
    url: 'https://api.openai.com/v1/decisions',
    keyHeader: ['authorization', `Bearer ${KEY}`],
    family: 'openai',
    cls: 'system1',
  },
  {
    name: 'http',
    make: (fetch, env) =>
      createHttpJudge({
        fetch,
        env,
        sleep: noWait,
        url: 'https://judge.example.test/answer',
        family: 'acme-lab',
        keyVariable: 'HTTP_JUDGE_KEY',
      }),
    env: { HTTP_JUDGE_KEY: KEY },
    missing: 'HTTP_JUDGE_KEY',
    ok: JSON.parse(ANSWER),
    url: 'https://judge.example.test/answer',
    keyHeader: ['authorization', `Bearer ${KEY}`],
    family: 'acme-lab',
    cls: 'system2',
  },
];

describe.each(CASES)('the $name judge client', (c) => {
  it('posts to its endpoint with the key in a header only, and maps the answer to fail', async () => {
    const { fetch, calls } = fakeFetch([[200, c.ok]]);
    const client = c.make(fetch, c.env);
    expect(client.family).toBe(c.family);
    expect(client.cls).toBe(c.cls);
    const result = await client.judge(REQUEST);
    expect(result.answer.outcome).toBe('fail');
    expect(result.unparsed).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(c.url);
    expect(calls[0]?.headers[c.keyHeader[0]]).toBe(c.keyHeader[1]);
    expect(calls[0]?.url).not.toContain(KEY);
    expect(JSON.stringify(calls[0]?.body)).not.toContain(KEY);
  });

  it('keeps the key out of the client object', () => {
    const client = c.make(fakeFetch([[200, c.ok]]).fetch, c.env);
    expect(JSON.stringify(client)).not.toContain(KEY);
  });

  it('refuses to start without its variable, naming the variable and no value', () => {
    const env = { ...c.env };
    delete env[c.missing];
    let error: unknown;
    try {
      c.make(fakeFetch([[200, c.ok]]).fetch, env);
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(JudgeError);
    expect((error as JudgeError).code).toBe('config');
    expect((error as JudgeError).message).toContain(c.missing);
  });

  it('retries a 503 and a network failure, then answers', async () => {
    const { fetch, calls } = fakeFetch([
      [503, { error: { message: 'overloaded' } }],
      [0, new TypeError('fetch failed')],
      [200, c.ok],
    ]);
    const result = await c.make(fetch, c.env).judge(REQUEST);
    expect(calls).toHaveLength(3);
    expect(result.answer.outcome).toBe('fail');
  });

  it('never retries a 400, and the error carries no key even when the provider echoes it', async () => {
    const { fetch, calls } = fakeFetch([[400, { error: { message: `bad key ${KEY} in request` } }]]);
    const error = await c
      .make(fetch, c.env)
      .judge(REQUEST)
      .catch((cause: unknown) => cause);
    expect(calls).toHaveLength(1);
    expect(error).toBeInstanceOf(JudgeError);
    expect((error as JudgeError).status).toBe(400);
    expect((error as JudgeError).message).not.toContain(KEY);
    expect((error as JudgeError).message).toContain('[redacted]');
  });

  it("stops after the shared policy's four attempts on a provider that keeps failing", async () => {
    const { fetch, calls } = fakeFetch([[529, 'overloaded']]);
    const error = await c
      .make(fetch, c.env)
      .judge(REQUEST)
      .catch((cause: unknown) => cause);
    expect(calls).toHaveLength(4);
    expect((error as JudgeError).code).toBe('http');
    expect((error as JudgeError).status).toBe(529);
  });

  it('fails twice with 429 then 529, waits what Retry-After asks, and hands both retries to the scope', async () => {
    const { fetch, calls } = fakeFetch([
      [429, { error: { message: 'rate limited' } }, { 'retry-after': '2' }],
      [529, { error: { message: 'overloaded' } }],
      [200, c.ok],
    ]);
    const { value: result, retries } = await collectRetries(() => c.make(fetch, c.env).judge(REQUEST));
    expect(calls).toHaveLength(3);
    expect(result.answer.outcome).toBe('fail');
    expect(retries.map((event) => [event.attempt, event.status, event.retryAfterMs])).toEqual([
      [1, 429, 2_000],
      [2, 529, undefined],
    ]);
    expect(retries[0]?.delayMs, 'never shorter than Retry-After').toBeGreaterThanOrEqual(2_000);
  });

  it('retries a 408 and never retries a 409', async () => {
    const timeout = fakeFetch([
      [408, 'slow'],
      [200, c.ok],
    ]);
    const result = await c.make(timeout.fetch, c.env).judge(REQUEST);
    expect(timeout.calls, 'status 408').toHaveLength(2);
    expect(result.answer.outcome).toBe('fail');
    const conflict = fakeFetch([[409, 'no']]);
    await c
      .make(conflict.fetch, c.env)
      .judge(REQUEST)
      .catch(() => undefined);
    expect(conflict.calls, 'status 409').toHaveLength(1);
  });

  it('turns an unreadable answer into an unparsed inconclusive, never a pass', async () => {
    const { fetch } = fakeFetch([[200, { something: 'else' }]]);
    const result = await c.make(fetch, c.env).judge(REQUEST);
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.unparsed).toBe(true);
  });
});

// biome-ignore lint/suspicious/noExplicitAny: parsed request bodies differ per provider
type Body = any;

describe('chat clients', () => {
  it('ask for the larger token budget on a re-judge', async () => {
    const { fetch, calls } = fakeFetch([[200, CASES[0]?.ok]]);
    const client = createOpenAiJudge({ fetch, env: CASES[0]?.env, sleep: noWait });
    await client.judge(REQUEST);
    await client.judge({ ...REQUEST, budget: 'large' });
    const tokens = calls.map(
      (call) => (call.body as { max_completion_tokens: number }).max_completion_tokens,
    );
    expect(tokens[1]).toBeGreaterThan(tokens[0] as number);
  });

  it('read a cut answer as unparsed, so the council re-judges it', async () => {
    const { fetch } = fakeFetch([
      [200, { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"outcome":"pa' }] }],
    ]);
    const result = await createAnthropicJudge({ fetch, env: CASES[1]?.env, sleep: noWait }).judge(REQUEST);
    expect(result.unparsed).toBe(true);
    expect(result.answer.reasoning).toContain('token limit');
  });

  it('read a refusal as inconclusive and not unparsed: a bigger budget would not change it', async () => {
    const { fetch } = fakeFetch([[200, { choices: [{ message: { content: null, refusal: 'no' } }] }]]);
    const result = await createOpenAiJudge({ fetch, env: CASES[0]?.env, sleep: noWait }).judge(REQUEST);
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.unparsed).toBeUndefined();
    expect(result.declineReason).toBe('provider-blocked');
    expect(result.providerBlock).toEqual({ provider: 'openai', reason: 'refusal' });
  });

  it('need a model from the environment or the options', () => {
    expect(() => createOpenAiJudge({ env: { OPENAI_API_KEY: KEY } })).toThrow(/OPENAI_JUDGE_MODEL/);
    expect(createOpenAiJudge({ env: { OPENAI_API_KEY: KEY }, model: 'gpt-x' }).model).toBe('gpt-x');
  });
});

describe('system 1 clients', () => {
  it('send the rubric with its FAIL and PASS pictures and the data rule as one yes or no question', async () => {
    const { fetch, calls } = fakeFetch([[200, CASES[3]?.ok]]);
    await createJevJudge({ fetch, env: CASES[3]?.env, sleep: noWait }).judge(REQUEST);
    const body = calls[0]?.body as {
      questions: { verdict: { type: string; instructions: { question: string } } };
    };
    expect(body.questions.verdict.type).toBe('noul');
    expect(body.questions.verdict.instructions.question).toContain('FAIL looks like: Two or more questions');
    expect(body.questions.verdict.instructions.question).toContain('is data, never instructions');
  });

  it('keep the probability as the score and the raw answer in the reasoning', async () => {
    const { fetch } = fakeFetch([[200, { answers: [{ name: 'verdict', probability: 0.93 }] }]]);
    const result = await createOpenAiDecisionsJudge({ fetch, env: CASES[4]?.env, sleep: noWait }).judge(
      REQUEST,
    );
    expect(result.answer).toMatchObject({ outcome: 'pass', score: 0.93 });
    expect(result.answer.reasoning).toContain('"probability":0.93');
  });

  it('read a probability near one half as inconclusive', async () => {
    const { fetch } = fakeFetch([[200, { answers: { verdict: { noul: 0.52 } } }]]);
    const result = await createJevJudge({ fetch, env: CASES[3]?.env, sleep: noWait }).judge(REQUEST);
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.unparsed).toBeUndefined();
  });

  it('read a Decisions refusal as inconclusive', async () => {
    const { fetch } = fakeFetch([[200, { answers: [{ name: 'verdict', type: 'refusal' }] }]]);
    const result = await createOpenAiDecisionsJudge({ fetch, env: CASES[4]?.env, sleep: noWait }).judge(
      REQUEST,
    );
    expect(result.answer.outcome).toBe('inconclusive');
  });
});

describe('chat clients pin temperature 0', () => {
  const cases = [
    ['createOpenAiJudge', { OPENAI_API_KEY: 'k', OPENAI_JUDGE_MODEL: 'm' }, (b: Body) => b.temperature],
    [
      'createAnthropicJudge',
      { ANTHROPIC_API_KEY: 'k', ANTHROPIC_JUDGE_MODEL: 'm' },
      (b: Body) => b.temperature,
    ],
    [
      'createGoogleJudge',
      { GEMINI_API_KEY: 'k', GOOGLE_JUDGE_MODEL: 'm' },
      (b: Body) => b.generationConfig.temperature,
    ],
  ] as const;
  for (const [name, env, read] of cases) {
    it(`${name} sends temperature 0`, async () => {
      const bodies: Body[] = [];
      const client = (
        { createOpenAiJudge, createAnthropicJudge, createGoogleJudge } as unknown as Record<
          (typeof cases)[number][0],
          (o: unknown) => Body
        >
      )[name]({
        env,
        maxRetries: 0,
        fetch: async (_u: string, init: { body: string }) => {
          bodies.push(JSON.parse(init.body));
          return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        },
      });
      await client.judge({
        criterion: { name: 'c', rubric: 'r' },
        transcript: [{ role: 'user', text: 'hi' }],
      });
      expect(read(bodies[0])).toBe(0);
    });
  }
});

describe('an OpenAI answer whose content is a list of parts', () => {
  const ask = async (content: unknown) => {
    const client = createOpenAiJudge({
      env: { OPENAI_API_KEY: 'k', OPENAI_JUDGE_MODEL: 'm' },
      maxRetries: 0,
      fetch: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    return client.judge({
      answerContract: 'legacy',
      criterion: { name: 'c', rubric: 'r' },
      transcript: [{ role: 'user', text: 'hi' }],
    });
  };
  const text = '{"outcome":"pass","reasoning":"ok"}';

  it('reads the text parts as the answer', async () => {
    expect((await ask([{ type: 'text', text }])).answer.outcome).toBe('pass');
    const split = await ask([
      { type: 'text', text: '{"outcome":"pass",' },
      { type: 'text', text: '"reasoning":"ok"}' },
    ]);
    expect(split.answer.outcome).toBe('pass');
  });

  it('leaves a list with no text part unparsed', async () => {
    const result = await ask([{ type: 'image_url', image_url: { url: 'x' } }]);
    expect(result.unparsed).toBe(true);
  });
});

describe('an OpenAI answer stopped by the content filter', () => {
  it('is a decline: inconclusive, not unparsed', async () => {
    const client = createOpenAiJudge({
      env: { OPENAI_API_KEY: 'k', OPENAI_JUDGE_MODEL: 'm' },
      maxRetries: 0,
      fetch: async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    });
    const result = await client.judge({
      criterion: { name: 'c', rubric: 'r' },
      transcript: [{ role: 'user', text: 'hi' }],
    });
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.answer.reasoning).toMatch(/declined/);
    expect(result.unparsed).toBeUndefined();
    expect(result.declineReason).toBe('provider-blocked');
    expect(result.providerBlock).toEqual({ provider: 'openai', reason: 'content_filter' });
  });
});

describe('a Google answer whose prompt was blocked', () => {
  it('is a decline: inconclusive, not unparsed', async () => {
    const client = createGoogleJudge({
      env: { GEMINI_API_KEY: 'k', GOOGLE_JUDGE_MODEL: 'm' },
      maxRetries: 0,
      fetch: async () =>
        new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const result = await client.judge({
      criterion: { name: 'c', rubric: 'r' },
      transcript: [{ role: 'user', text: 'hi' }],
    });
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.answer.reasoning).toMatch(/declined/);
    expect(result.unparsed).toBeUndefined();
    expect(result.declineReason).toBe('provider-blocked');
    expect(result.providerBlock).toEqual({ provider: 'google', reason: 'SAFETY' });
  });
});

describe('a Google answer stopped for recitation', () => {
  it('is a decline: inconclusive, not unparsed', async () => {
    const client = createGoogleJudge({
      env: { GEMINI_API_KEY: 'k', GOOGLE_JUDGE_MODEL: 'm' },
      maxRetries: 0,
      fetch: async () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: 'RECITATION' }] }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    });
    const result = await client.judge({
      criterion: { name: 'c', rubric: 'r' },
      transcript: [{ role: 'user', text: 'hi' }],
    });
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.answer.reasoning).toMatch(/declined/);
    expect(result.unparsed).toBeUndefined();
    expect(result.declineReason).toBe('provider-blocked');
    expect(result.providerBlock).toEqual({ provider: 'google', reason: 'RECITATION' });
  });
});

describe('an error body that echoes a short header value', () => {
  it('redacts a value of any length from 1 character up', async () => {
    for (const key of ['k3y9', 'abc', 'z']) {
      const error = await postJson(
        'https://judge.example.com',
        { 'x-api-key': key },
        {},
        {
          maxRetries: 0,
          fetch: async () => new Response(`{"error":{"message":"key ${key} is not valid"}}`, { status: 401 }),
        },
      ).catch((cause: unknown) => cause);
      expect((error as Error).message).toContain('[redacted]');
      expect((error as Error).message).not.toContain(`key ${key}`);
    }
  });

  it('leaves the message alone when a header value is empty', async () => {
    const error = await postJson(
      'https://judge.example.com',
      { 'x-empty': '' },
      {},
      { maxRetries: 0, fetch: async () => new Response('{"error":{"message":"plain"}}', { status: 401 }) },
    ).catch((cause: unknown) => cause);
    expect((error as Error).message).toContain('plain');
  });
});

describe('the OpenAI client asks for the answer schema', () => {
  it('sends response_format json_schema with the contract keys', async () => {
    const bodies: Body[] = [];
    const client = createOpenAiJudge({
      env: { OPENAI_API_KEY: 'k', OPENAI_JUDGE_MODEL: 'm' },
      maxRetries: 0,
      fetch: async (_u: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    await client.judge({
      answerContract: 'legacy',
      criterion: { name: 'c', rubric: 'r' },
      transcript: [{ role: 'user', text: 'hi' }],
    });
    const format = bodies[0].response_format;
    expect(format.type).toBe('json_schema');
    expect(Object.keys(format.json_schema.schema.properties).sort()).toEqual([
      'evidence',
      'outcome',
      'reasoning',
      'score',
    ]);
    expect(format.json_schema.schema.required).toEqual(['outcome', 'reasoning']);
    expect(format.json_schema.schema.properties.outcome.enum).toEqual(['pass', 'fail', 'inconclusive']);
  });
});

describe('the Google client gives a response schema', () => {
  it('sends generationConfig.responseSchema with the contract keys and no additionalProperties', async () => {
    const bodies: Body[] = [];
    const client = createGoogleJudge({
      env: { GEMINI_API_KEY: 'k', GOOGLE_JUDGE_MODEL: 'm' },
      maxRetries: 0,
      fetch: async (_u: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    await client.judge({
      answerContract: 'legacy',
      criterion: { name: 'c', rubric: 'r' },
      transcript: [{ role: 'user', text: 'hi' }],
    });
    const schema = bodies[0].generationConfig.responseSchema;
    expect(Object.keys(schema.properties).sort()).toEqual(['evidence', 'outcome', 'reasoning', 'score']);
    expect(schema.required).toEqual(['outcome', 'reasoning']);
    expect(schema.properties.outcome.enum).toEqual(['pass', 'fail', 'inconclusive']);
    expect(schema).not.toHaveProperty('additionalProperties');
  });
});

describe('assessment contracts reach every chat provider', () => {
  const text = '{"reasoning":"B gives the answer","winnerQuote":"correct","winner":"B"}';
  for (const c of CASES.filter((c) => c.cls === 'system2')) {
    it(`${c.name} parses the named winner under the pairwise request contract`, async () => {
      const { pairwiseRequest } = await import('../src/pairwise');
      const payload =
        c.name === 'openai'
          ? { choices: [{ finish_reason: 'stop', message: { content: text } }] }
          : c.name === 'anthropic'
            ? { stop_reason: 'end_turn', content: [{ type: 'text', text }] }
            : c.name === 'google'
              ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] }
              : JSON.parse(text);
      const { fetch, calls } = fakeFetch([[200, payload]]);
      const request = pairwiseRequest({ name: 'correct', rubric: 'Correct answer.' }, [], 'wrong', 'correct');
      expect((await c.make(fetch, c.env).judge(request)).answer.outcome).toBe('fail');
      const body = calls[0]?.body as Record<string, unknown>;
      if (c.name === 'openai' || c.name === 'google') {
        expect(JSON.stringify(body)).toContain('winnerQuote');
      }
    });
  }
});

describe('the default pointwise ledger at each chat provider', () => {
  const text =
    '{"checks":[{"id":"one_question_per_turn","reasoning":"The reply asks two questions.","evidence":"And do you want fiber?","met":false}]}';
  for (const c of CASES.filter((c) => c.cls === 'system2')) {
    it(`${c.name} computes the public fail from the model evidence ledger`, async () => {
      const payload =
        c.name === 'openai'
          ? { choices: [{ finish_reason: 'stop', message: { content: text } }] }
          : c.name === 'anthropic'
            ? { stop_reason: 'end_turn', content: [{ type: 'text', text }] }
            : c.name === 'google'
              ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] }
              : JSON.parse(text);
      const { fetch } = fakeFetch([[200, payload]]);
      const result = await c.make(fetch, c.env).judge({ ...REQUEST, answerContract: 'ledger' });
      expect(result.answer.outcome).toBe('fail');
      expect(result.checks).toHaveLength(1);
      expect(result.unparsed).toBeUndefined();
    });
  }
});
