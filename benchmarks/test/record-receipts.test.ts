import type { ClientOptions, JudgeRequest } from '@agent-nexus/driftbench-judges';
import { afterEach, expect, it, vi } from 'vitest';
import { makeRecordingClient, SpendBudget, type SpendRow } from '../record';

const script = vi.hoisted(() => ({ limits: [1024, 2048] }));
vi.mock('@agent-nexus/driftbench-judges', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent-nexus/driftbench-judges')>();
  const multipleReceipts = (provider: 'openai' | 'google', options: ClientOptions = {}) => ({
    ...(provider === 'openai' ? actual.createOpenAiJudge(options) : actual.createGoogleJudge(options)),
    async judge(request: JudgeRequest) {
      for (const limit of script.limits) {
        if (!options.fetch) throw new Error('Missing observed fetch');
        await options.fetch('https://fictional.invalid/judge', {
          method: 'POST',
          body: JSON.stringify(
            provider === 'openai'
              ? { messages: [{ role: 'user', content: 'Fictional case.' }], max_completion_tokens: limit }
              : {
                  contents: [{ parts: [{ text: 'Fictional case.' }] }],
                  generationConfig: { maxOutputTokens: limit },
                },
          ),
        });
      }
      return actual.parseJudgeText('{}', request);
    },
  });
  return {
    ...actual,
    createOpenAiJudge: (options?: ClientOptions) => multipleReceipts('openai', options),
    createGoogleJudge: (options?: ClientOptions) => multipleReceipts('google', options),
  };
});
afterEach(() => {
  script.limits = [1024, 2048];
  vi.restoreAllMocks();
});
const request: JudgeRequest = {
  criterion: { name: 'c', rubric: 'Reply politely.' },
  transcript: [{ role: 'agent', text: 'Hello.' }],
};
function receipt(model: string) {
  return new Response(
    JSON.stringify(
      model === 'gpt-6-luna'
        ? { model, usage: { prompt_tokens: 100, completion_tokens: 100 } }
        : {
            modelVersion: model,
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 60 },
          },
    ),
    { status: 200 },
  );
}

it.each([
  ['gpt-6-luna', 0.00006],
  ['gemini-3.8-flash', 0.00045],
  ['gemini-3.5-flash-lite', 0.00028],
])('sums every billed %s receipt in one judgment', async (model, cost) => {
  const budget = new SpendBudget(1);
  const reserve = vi.spyOn(budget, 'reserve');
  const rows: SpendRow[] = [];
  const fetch = vi.fn(async () => receipt(model));
  const client = makeRecordingClient(
    model,
    budget,
    { OPENAI_API_KEY: 'fictional', GEMINI_API_KEY: 'fictional' },
    (row) => rows.push(row),
    { fetch },
  );
  const result = await client.judge(request);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(reserve).toHaveBeenCalledTimes(2);
  expect(result.costUsd).toBeCloseTo(2 * cost, 12);
  expect(budget.spent).toBeCloseTo(2 * cost, 12);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    costUsd: 2 * cost,
    chargedUsd: 2 * cost,
    inputTokens: 200,
    outputTokens: 200,
    status: 'ok',
  });
});

it('reserves the next wire allowance before a larger recovery can be billed', async () => {
  script.limits = [16_384, 32_768];
  const budget = new SpendBudget(0.01);
  const rows: SpendRow[] = [];
  const fetch = vi.fn(async () => receipt('gpt-6-luna'));
  const client = makeRecordingClient(
    'gpt-6-luna',
    budget,
    { OPENAI_API_KEY: 'fictional' },
    (row) => rows.push(row),
    { fetch },
  );
  await expect(client.judge(request)).rejects.toThrow('spend cap reached');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(budget.spent).toBeCloseTo(0.00006, 12);
  expect(rows[0]).toMatchObject({ costUsd: 0.00006, chargedUsd: 0.00006, status: 'error' });
});

it('keeps the first bill and the unmetered recovery reservation on an error', async () => {
  const budget = new SpendBudget(1);
  const reserve = vi.spyOn(budget, 'reserve');
  const rows: SpendRow[] = [];
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(receipt('gpt-6-luna'))
    .mockRejectedValueOnce(new Error('Fictional timeout'));
  const client = makeRecordingClient(
    'gpt-6-luna',
    budget,
    { OPENAI_API_KEY: 'fictional' },
    (row) => rows.push(row),
    { fetch },
  );
  await expect(client.judge(request)).rejects.toThrow('Fictional timeout');
  expect(reserve).toHaveBeenCalledTimes(2);
  const secondReservation = reserve.mock.calls[1]?.[0] ?? 0;
  expect(secondReservation).toBeGreaterThan(0);
  expect(budget.spent).toBeCloseTo(0.00006 + secondReservation, 12);
  expect(rows[0]).toMatchObject({
    costUsd: 0.00006,
    chargedUsd: budget.spent,
    accounting: 'reserved-on-error',
    status: 'error',
  });
});
