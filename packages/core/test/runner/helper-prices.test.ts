import { describe, expect, it } from 'vitest';
import { priceObserved, TokenPriceError } from '../../src/runner/pricing';
import type { Observed } from '../../src/schema/run';

const target = { adapter: 'echo', options: { model: 'fictional-agent' } };
const prices = {
  as_of: '2026-10-22',
  models: {
    'fictional-agent': { input: 2, output: 4, cached_input: 0.5 },
    'fictional-helper': { input: 1, output: 3, cached_input: 0.25 },
  },
};
const observed = (cost: Observed['cost']): Observed => ({
  segments: [],
  text: '',
  toolCalls: [],
  cost,
  latencyMs: 0,
});

describe('helper tokens are priced with the helper model', () => {
  it('reports the helper dollars apart from the agent and adds them to the total', () => {
    const priced = priceObserved(
      observed({
        inputTokens: 1000,
        outputTokens: 500,
        helperInputTokens: 2000,
        helperOutputTokens: 100,
        helperModel: 'fictional-helper',
      }),
      target,
      prices,
      true,
    );
    // Agent: (1000 * 2 + 500 * 4) / 1e6. Helper: (2000 * 1 + 100 * 3) / 1e6.
    expect(priced.cost.helperUsd).toBeCloseTo(0.0023, 10);
    expect(priced.cost.usd).toBeCloseTo(0.0063, 10);
  });

  it('prices the helper with the agent model when the records name none', () => {
    const priced = priceObserved(
      observed({ inputTokens: 1000, outputTokens: 500, helperInputTokens: 1000, helperOutputTokens: 0 }),
      target,
      prices,
      true,
    );
    expect(priced.cost.helperUsd).toBeCloseTo(0.002, 10);
    expect(priced.cost.usd).toBeCloseTo(0.006, 10);
  });

  it('uses the one model the segments name for the agent, as the agent pricing does', () => {
    const priced = priceObserved(
      {
        ...observed({
          inputTokens: 1000,
          outputTokens: 500,
          helperInputTokens: 1000,
          helperOutputTokens: 0,
        }),
        segments: [{ type: 'text', text: 'ok', cost: { model: 'fictional-agent' } }],
      },
      { adapter: 'echo' },
      prices,
      true,
    );
    // The target names no model: the segment's model prices the agent and, with none for the helper, the helper.
    expect(priced.cost.helperUsd).toBeCloseTo(0.002, 10);
    expect(priced.cost.usd).toBeCloseTo(0.006, 10);
  });

  it('prices a run that has only helper tokens', () => {
    const priced = priceObserved(
      observed({ helperInputTokens: 1000, helperOutputTokens: 0, helperModel: 'fictional-helper' }),
      target,
      prices,
      true,
    );
    expect(priced.cost.helperUsd).toBeCloseTo(0.001, 10);
    expect(priced.cost.usd).toBeCloseTo(0.001, 10);
  });

  it('refuses to price a budgeted run whose helper model has no price', () => {
    expect(() =>
      priceObserved(
        observed({ inputTokens: 10, helperInputTokens: 10, helperModel: 'fictional-unlisted' }),
        target,
        prices,
        true,
      ),
    ).toThrow(TokenPriceError);
  });

  it('leaves the dollars an adapter reported as they are', () => {
    const reported = observed({ usd: 1, helperInputTokens: 10, helperModel: 'fictional-helper' });
    expect(priceObserved(reported, target, prices, true)).toBe(reported);
  });

  it('changes nothing for a run with no helper tokens', () => {
    const priced = priceObserved(observed({ inputTokens: 1000, outputTokens: 500 }), target, prices, true);
    expect(priced.cost.usd).toBeCloseTo(0.004, 10);
    expect(priced.cost.helperUsd).toBeUndefined();
  });
});
