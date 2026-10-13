import { describe, expect, it } from 'vitest';
import { makeRecordingClient, openAiCost, SpendBudget } from '../record';

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
