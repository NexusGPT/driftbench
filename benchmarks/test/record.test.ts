import { afterEach, describe, expect, it, vi } from 'vitest';
import { geminiCost, makeRecordingClient, openAiCost, SpendBudget } from '../record';

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
