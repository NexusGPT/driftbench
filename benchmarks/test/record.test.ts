import { afterEach, describe, expect, it, vi } from 'vitest';
import { GEMINI_LITE_RATES, geminiCost, makeRecordingClient, openAiCost, SpendBudget } from '../record';

afterEach(() => vi.restoreAllMocks());

describe('recording spends only within the cap', () => {
  it('reserves all in-flight requests and refuses the next before a live call', () => {
    const budget = new SpendBudget(0.05);
    const a = budget.reserve(0.03);
    expect(() => budget.reserve(0.03)).toThrow('spend cap');
    budget.settle(a, 0.01);
    const b = budget.reserve(0.03);
    budget.settle(b, 0.02);
    expect(budget.spent).toBeCloseTo(0.03);
  });
  it('reports an overrun and still accounts for every charged dollar', () => {
    const budget = new SpendBudget(0.02);
    const token = budget.reserve(0.02);
    expect(() => budget.settle(token, 0.03)).toThrow('exceeded');
    expect(budget.spent).toBe(0.03);
  });
  it('holds the reservation on an unmetered failure', () => {
    const budget = new SpendBudget(0.04);
    const a = budget.reserve(0.03);
    budget.settle(a, undefined);
    expect(budget.spent).toBe(0.03);
    expect(() => budget.reserve(0.02)).toThrow('spend cap');
  });
  it('prices cached and output tokens and refuses missing usage', () => {
    expect(
      openAiCost({
        prompt_tokens: 1000,
        completion_tokens: 200,
        prompt_tokens_details: { cached_tokens: 500 },
      }),
    ).toBeCloseTo(0.000155);
    expect(() => openAiCost({})).toThrow('usage');
  });
  it('disallows ambient model or base URL overrides of the recorded identity', () => {
    expect(() =>
      makeRecordingClient(
        'gpt-6-luna',
        new SpendBudget(1),
        { OPENAI_API_KEY: 'fictional', OPENAI_JUDGE_MODEL: 'other' },
        () => {},
      ),
    ).toThrow('override');
  });
});

describe('Gemini recording accounting', () => {
  it('counts cached input and hidden thinking output at the published rates', () => {
    expect(
      geminiCost({
        promptTokenCount: 1000,
        cachedContentTokenCount: 500,
        candidatesTokenCount: 200,
        thoughtsTokenCount: 300,
      }),
    ).toBeCloseTo(0.0022875);
    expect(() => geminiCost({})).toThrow('usage');
    expect(() =>
      geminiCost({ promptTokenCount: 3, cachedContentTokenCount: 4, candidatesTokenCount: 1 }),
    ).toThrow('usage');
  });
  it('records the resolved model and bills thinking when the public Google client returns', async () => {
    const budget = new SpendBudget(1);
    const rows: Array<{ resolvedModel: string; chargedUsd: number; outputTokens?: number }> = [];
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const client = makeRecordingClient(
      'gemini-3.8-flash',
      budget,
      { GEMINI_API_KEY: 'fictional' },
      (row) => rows.push(row),
      {
        fetch: async (_url, init) => {
          expect(JSON.parse(String(init?.body)).generationConfig.thinkingConfig.thinkingLevel).toBe('medium');
          return new Response(
            JSON.stringify({
              modelVersion: 'gemini-3.8-flash',
              usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 200 },
              candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
            }),
            { status: 200 },
          );
        },
      },
    );
    await client.judge({
      criterion: { name: 'c', rubric: 'The answer is polite.' },
      transcript: [{ role: 'agent', text: 'Good morning.' }],
    });
    expect(timeout).toHaveBeenCalledWith(300_000);
    timeout.mockRestore();
    expect(JSON.parse(client.settings ?? '{}').reasoning).toBe('medium');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.resolvedModel).toBe('gemini-3.8-flash');
    expect(rows[0]?.outputTokens).toBe(300);
    expect(budget.spent).toBeCloseTo(0.001875);
  });
});

it('keeps free replay construction available after Gemini pricing expires, but stops live calls', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2027-01-01T00:00:00Z'));
  const fetch = vi.fn();
  const client = makeRecordingClient(
    'gemini-3.8-flash',
    new SpendBudget(1),
    { GEMINI_API_KEY: 'fictional' },
    () => {},
    { fetch },
  );
  expect(client.model).toBe('gemini-3.8-flash');
  await expect(
    client.judge({
      criterion: { name: 'c', rubric: 'Reply politely.' },
      transcript: [{ role: 'agent', text: 'Hello.' }],
    }),
  ).rejects.toThrow('pricing expired');
  expect(fetch).not.toHaveBeenCalled();
});

it('selects medium reasoning for Luna through the public client', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const client = makeRecordingClient(
    'gpt-6-luna',
    new SpendBudget(1),
    { OPENAI_API_KEY: 'fictional' },
    () => {},
    {
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            model: 'gpt-6-luna',
            usage: { prompt_tokens: 100, completion_tokens: 100 },
            choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
          }),
          { status: 200 },
        );
      },
    },
  );
  await client.judge({
    criterion: { name: 'c', rubric: 'Reply politely.' },
    transcript: [{ role: 'agent', text: 'Hello.' }],
  });
  expect(bodies[0]?.reasoning_effort).toBe('medium');
  expect(JSON.parse(client.settings ?? '{}').reasoning).toBe('medium');
});

it('reserves the Gemini model output ceiling before starting a billed call', async () => {
  const fetch = vi.fn();
  const client = makeRecordingClient(
    'gemini-3.8-flash',
    new SpendBudget(0.1),
    { GEMINI_API_KEY: 'fictional' },
    () => {},
    { fetch },
  );
  await expect(
    client.judge({
      criterion: { name: 'c', rubric: 'Reply politely.' },
      transcript: [{ role: 'agent', text: 'Hello.' }],
    }),
  ).rejects.toThrow('spend cap reached');
  expect(fetch).not.toHaveBeenCalled();
});

it('waits 60, 120 and 240 seconds after Gemini 429s and retries the same public request', async () => {
  const bodies: string[] = [];
  const delays: number[] = [];
  const client = makeRecordingClient(
    'gemini-3.8-flash',
    new SpendBudget(1),
    { GEMINI_API_KEY: 'fictional' },
    () => {},
    {
      sleep: async (ms) => {
        delays.push(ms);
      },
      fetch: async (_url, init) => {
        bodies.push(String(init?.body));
        if (bodies.length <= 3) return new Response('Fictional rate limit', { status: 429 });
        return new Response(
          JSON.stringify({
            modelVersion: 'gemini-3.8-flash',
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100 },
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
          }),
          { status: 200 },
        );
      },
    },
  );
  await client.judge({
    criterion: { name: 'c', rubric: 'Reply politely.' },
    transcript: [{ role: 'agent', text: 'Hello.' }],
  });
  expect(delays).toEqual([60_000, 120_000, 240_000]);
  expect(bodies).toHaveLength(4);
  expect(new Set(bodies).size).toBe(1);
});

it.each([
  [429, 4, 3],
  [503, 1, 0],
])('bounds Gemini HTTP %i retries to %i attempts', async (status, attempts, waits) => {
  const fetch = vi.fn(async () => new Response('Fictional failure', { status }));
  const sleep = vi.fn(async () => {});
  const rows: unknown[] = [];
  const client = makeRecordingClient(
    'gemini-3.8-flash',
    new SpendBudget(1),
    { GEMINI_API_KEY: 'fictional' },
    (row) => rows.push(row),
    { fetch, sleep },
  );
  await expect(
    client.judge({
      criterion: { name: 'c', rubric: 'Reply politely.' },
      transcript: [{ role: 'agent', text: 'Hello.' }],
    }),
  ).rejects.toThrow(`answered ${status}`);
  expect(fetch).toHaveBeenCalledTimes(attempts);
  expect(sleep).toHaveBeenCalledTimes(waits);
  expect(rows).toHaveLength(1);
});

it('prices Flash-Lite cached input and thinking at its own rates', () => {
  expect(
    geminiCost(
      {
        promptTokenCount: 1000,
        cachedContentTokenCount: 500,
        candidatesTokenCount: 200,
        thoughtsTokenCount: 300,
      },
      GEMINI_LITE_RATES,
    ),
  ).toBeCloseTo(0.001415, 12);
});

it('records Flash-Lite at medium with its own reservation, settings and resolved identity', async () => {
  const budget = new SpendBudget(0.2);
  const rows: Array<{ resolvedModel: string; chargedUsd: number; outputTokens?: number }> = [];
  const reserve = vi.spyOn(budget, 'reserve');
  const client = makeRecordingClient(
    'gemini-3.5-flash-lite',
    budget,
    { GEMINI_API_KEY: 'fictional' },
    (row) => rows.push(row),
    {
      fetch: async (url, init) => {
        expect(String(url)).toContain('/gemini-3.5-flash-lite:generateContent');
        expect(JSON.parse(String(init?.body)).generationConfig.thinkingConfig.thinkingLevel).toBe('medium');
        return new Response(
          JSON.stringify({
            modelVersion: 'gemini-3.5-flash-lite',
            usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 200 },
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
          }),
          { status: 200 },
        );
      },
    },
  );
  await client.judge({
    criterion: { name: 'c', rubric: 'Reply politely.' },
    transcript: [{ role: 'agent', text: 'Hello.' }],
  });
  expect(JSON.parse(client.settings ?? '{}').reasoning).toBe('medium');
  expect(reserve.mock.calls[0]?.[0]).toBeGreaterThan((65536 * 2.5) / 1000000);
  expect(reserve.mock.calls[0]?.[0]).toBeLessThan(0.2);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ resolvedModel: 'gemini-3.5-flash-lite', outputTokens: 300 });
  expect(budget.spent).toBeCloseTo(0.00105, 12);
});
