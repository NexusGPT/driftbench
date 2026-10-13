import { type AgentAdapter, contentHash, type Observed, type TargetRef } from '@agent-nexus/driftbench-core';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { planCampaign, runCampaign, runSpec } from '../../src/runner';
import { echoAdapter, putCampaign, specOf } from './support';

const spec = specOf({
  id: 'token-budget',
  version: '1',
  blocks: [{ when: { user: 'hello' } }, { when: { user: 'again' } }],
});
const target = { adapter: 'echo', options: { model: 'fictional-model' } };
const prices = {
  as_of: '2026-10-13',
  models: { 'fictional-model': { input: 2, output: 4, cached_input: 0.5 } },
};
function tokenAdapter(cost: Observed['cost'] = { inputTokens: 1000, outputTokens: 500 }) {
  const adapter = echoAdapter();
  let calls = 0;
  let closed = 0;
  adapter.send = async () => {
    calls++;
    return { segments: [{ type: 'text', text: 'ok' }], text: 'ok', toolCalls: [], cost, latencyMs: 0 };
  };
  adapter.close = async () => {
    closed++;
  };
  return { adapter, calls: () => calls, closed: () => closed };
}
async function campaign(
  adapter: AgentAdapter,
  options: { prices?: typeof prices; budgetUsd?: number; targets?: TargetRef[]; repeats?: number },
) {
  const store = openMemoryStore();
  const loaded = [{ ok: true as const, spec, hash: contentHash(spec), path: 'fictional.yaml', warnings: [] }];
  await putCampaign(store, 'priced', loaded);
  try {
    return await runCampaign({
      campaignId: 'priced',
      cells: planCampaign(loaded, options.targets ?? [target], ['F'], options.repeats ?? 3).cells,
      specFor: () => spec,
      adapterFor: () => adapter,
      driver: () => createScriptedDriver(),
      checks: [],
      store,
      concurrency: 1,
      ...options,
    });
  } finally {
    await store.close();
  }
}

describe('token-only budget accounting', () => {
  it('prices tokens and stops the next cell when the budget is spent', async () => {
    const fake = tokenAdapter();
    const outcomes = await campaign(fake.adapter, { prices, budgetUsd: 0.005 });
    expect(outcomes.map((o) => o.state)).toEqual(['pass', 'stopped', 'stopped']);
    expect(outcomes[0]?.run?.cost).toBeCloseTo(0.008, 10);
    expect(fake.calls()).toBe(2);
  });
  it('refuses a declared unpriced model before the first send', async () => {
    const fake = tokenAdapter();
    await expect(campaign(fake.adapter, { budgetUsd: 1 })).rejects.toThrow(
      /fictional-model.*prices.*driftbench.yaml.*--prices/,
    );
    expect(fake.calls()).toBe(0);
    expect(fake.closed()).toBe(0);
  });
  it('leaves an unpriced run unchanged without a budget', async () => {
    const fake = tokenAdapter();
    const outcomes = await campaign(fake.adapter, {});
    expect(outcomes.map((o) => o.state)).toEqual(['pass', 'pass', 'pass']);
    expect(outcomes.map((o) => o.run?.cost)).toEqual([0, 0, 0]);
    expect(fake.calls()).toBe(6);
  });
  it('prefers reported dollars, including zero, over token estimates', async () => {
    const fake = tokenAdapter({ usd: 0, inputTokens: 1000 });
    const outcomes = await campaign(fake.adapter, { prices, budgetUsd: 1 });
    expect(outcomes[0]?.run?.cost).toBe(0);
    expect(fake.calls()).toBe(6);
  });
  it('prices cached input as a subset of input tokens', async () => {
    const fake = tokenAdapter({ inputTokens: 1000, outputTokens: 500, cachedInputTokens: 400 });
    const run = await runSpec(spec, {
      adapter: fake.adapter,
      driver: createScriptedDriver(),
      checks: [],
      mode: 'F',
      repeat: 0,
      target,
      prices,
    });
    expect(run.status).toBe('completed');
    expect(run.cost).toBeCloseTo(0.0068, 10);
    expect(run.blocks[0]?.observed.cost.usd).toBeCloseTo(0.0034, 10);
  });
});

it('uses per-observation model names and prices segment-only and mixed dollar/token costs once', async () => {
  const fake = tokenAdapter();
  fake.adapter.send = async () => ({
    segments: [
      { type: 'text', text: 'part', cost: { usd: 0.01 } },
      {
        type: 'text',
        text: 'rest',
        cost: { model: 'fictional-model', inputTokens: 1000, outputTokens: 500 },
      },
    ],
    text: 'ok',
    toolCalls: [],
    cost: {},
    latencyMs: 0,
  });
  const run = await runSpec(spec, {
    adapter: fake.adapter,
    driver: createScriptedDriver(),
    checks: [],
    mode: 'F',
    repeat: 0,
    prices,
    requireTokenPrices: true,
  });
  expect(run.cost).toBeCloseTo(0.028, 10);
});
it('does not count repeated aggregate tokens and segment tokens twice', async () => {
  const fake = tokenAdapter();
  const send = fake.adapter.send;
  fake.adapter.send = async (session, turn) => {
    const raw = await send(session, turn);
    return { ...raw, segments: [{ type: 'text', text: 'ok', cost: raw.cost }] };
  };
  const run = await runSpec(spec, {
    adapter: fake.adapter,
    driver: createScriptedDriver(),
    checks: [],
    mode: 'F',
    repeat: 0,
    target,
    prices,
  });
  expect(run.cost).toBeCloseTo(0.008, 10);
});
it('names an unpriced segment model even when the target has a price', async () => {
  const fake = tokenAdapter();
  fake.adapter.send = async () => ({
    segments: [{ type: 'text', text: 'ok', cost: { model: 'unknown-fictional-model', inputTokens: 1 } }],
    text: 'ok',
    toolCalls: [],
    cost: {},
    latencyMs: 0,
  });
  await expect(campaign(fake.adapter, { prices, budgetUsd: 1 })).rejects.toThrow(/unknown-fictional-model/);
});
it('refuses token usage with no model identity under a budget', async () => {
  const fake = tokenAdapter();
  await expect(
    runSpec(spec, {
      adapter: fake.adapter,
      driver: createScriptedDriver(),
      checks: [],
      mode: 'F',
      repeat: 0,
      prices,
      requireTokenPrices: true,
    }),
  ).rejects.toThrow(/unspecified.*target.options.model/);
});
it('counts previously stored token-only spend on resume instead of trusting its old zero cost', async () => {
  const store = openMemoryStore();
  const fake = tokenAdapter();
  const loaded = [{ ok: true as const, spec, hash: contentHash(spec), path: 'fictional.yaml', warnings: [] }];
  await putCampaign(store, 'resume', loaded);
  try {
    await runSpec(spec, {
      adapter: fake.adapter,
      driver: createScriptedDriver(),
      checks: [],
      mode: 'F',
      repeat: 0,
      target,
      store,
      campaignId: 'resume',
    });
    const outcomes = await runCampaign({
      campaignId: 'resume',
      cells: planCampaign(loaded, [target], ['F'], 2).cells,
      specFor: () => spec,
      adapterFor: () => fake.adapter,
      driver: () => createScriptedDriver(),
      checks: [],
      store,
      prices,
      budgetUsd: 0.005,
      concurrency: 1,
    });
    expect(outcomes.map((o) => o.state)).toEqual(['pass', 'stopped']);
    expect(fake.calls()).toBe(2);
  } finally {
    await store.close();
  }
});

it('uses the block model for segment-only token usage unless the segment names its own', async () => {
  const fake = tokenAdapter();
  fake.adapter.send = async () => ({
    segments: [{ type: 'text', text: 'ok', cost: { inputTokens: 1000, outputTokens: 500 } }],
    text: 'ok',
    toolCalls: [],
    cost: { model: 'fictional-model' },
    latencyMs: 0,
  });
  const run = await runSpec(spec, {
    adapter: fake.adapter,
    driver: createScriptedDriver(),
    checks: [],
    mode: 'F',
    repeat: 0,
    prices,
    requireTokenPrices: true,
  });
  expect(run.cost).toBeCloseTo(0.008, 10);
});

it('preflights every declared target before sending to a priced target', async () => {
  const fake = tokenAdapter();
  await expect(
    campaign(fake.adapter, {
      prices,
      budgetUsd: 1,
      repeats: 1,
      targets: [target, { adapter: 'echo', options: { model: 'missing-model' } }],
    }),
  ).rejects.toThrow(/missing-model/);
  expect(fake.calls()).toBe(0);
});
it('lists every unpriced declared model in the startup error', async () => {
  const fake = tokenAdapter();
  await expect(
    campaign(fake.adapter, {
      budgetUsd: 1,
      targets: [target, { adapter: 'echo', options: { model: 'missing-model' } }],
    }),
  ).rejects.toThrow(/fictional-model.*missing-model.*prices/);
  expect(fake.calls()).toBe(0);
});
it.each([true, false])(
  'prices aggregate tokens with model-only segment metadata (target model: %s)',
  async (declared) => {
    const fake = tokenAdapter();
    const send = fake.adapter.send;
    fake.adapter.send = async (session, turn) => ({
      ...(await send(session, turn)),
      segments: [{ type: 'text', text: 'ok', cost: { model: 'fictional-model' } }],
    });
    const outcomes = await campaign(fake.adapter, {
      prices,
      budgetUsd: 0.005,
      targets: declared ? [target] : [{ adapter: 'echo' }],
    });
    expect(outcomes[0]?.run?.cost).toBeCloseTo(0.008, 10);
    expect(outcomes.map((o) => o.state)).toEqual(['pass', 'stopped', 'stopped']);
    expect(fake.calls()).toBe(2);
  },
);
it('stops at the first block when an unpriced model becomes known only at runtime', async () => {
  const fake = tokenAdapter({ model: 'runtime-model', inputTokens: 1000, outputTokens: 500 });
  await expect(
    campaign(fake.adapter, {
      prices,
      budgetUsd: 1,
      targets: [{ adapter: 'echo' }],
    }),
  ).rejects.toThrow(/runtime-model.*prices/);
  expect(fake.calls()).toBe(1);
  expect(fake.closed()).toBe(1);
});
it('stops when aggregate tokens have model-only metadata with no known price', async () => {
  const fake = tokenAdapter();
  const send = fake.adapter.send;
  fake.adapter.send = async (session, turn) => ({
    ...(await send(session, turn)),
    segments: [{ type: 'text', text: 'ok', cost: { model: 'runtime-model' } }],
  });
  await expect(campaign(fake.adapter, { prices, budgetUsd: 1 })).rejects.toThrow(/runtime-model/);
  expect(fake.calls()).toBe(1);
});
it('charges fully cached input only at the cache rate and stops later cells', async () => {
  const fake = tokenAdapter({ inputTokens: 1000, cachedInputTokens: 1000, outputTokens: 0 });
  const outcomes = await campaign(fake.adapter, { prices, budgetUsd: 0.0009 });
  expect(outcomes[0]?.run?.cost).toBeCloseTo(0.001, 10);
  expect(outcomes.map((o) => o.state)).toEqual(['pass', 'stopped', 'stopped']);
  expect(fake.calls()).toBe(2);
});
it('allows explicitly supplied zero prices', async () => {
  const fake = tokenAdapter();
  const outcomes = await campaign(fake.adapter, {
    prices: { ...prices, models: { 'fictional-model': { input: 0, output: 0, cached_input: 0 } } },
    budgetUsd: 1,
  });
  expect(outcomes.map((o) => o.run?.cost)).toEqual([0, 0, 0]);
  expect(fake.calls()).toBe(6);
});

it('preflights a direct run before asking its driver for a potentially paid turn', async () => {
  const fake = tokenAdapter();
  let turns = 0;
  await expect(
    runSpec(spec, {
      adapter: fake.adapter,
      driver: {
        id: 'paid-user',
        next: () => {
          turns++;
          return { kind: 'stop', reason: 'done' };
        },
      },
      checks: [],
      mode: 'F',
      repeat: 0,
      target,
      requireTokenPrices: true,
    }),
  ).rejects.toThrow(/fictional-model/);
  expect(turns).toBe(0);
  expect(fake.calls()).toBe(0);
});
it.each([
  { costs: [{ model: 'fictional-model' }, { model: 'another-model' }] },
  { costs: [{ model: 'fictional-model', inputTokens: 1 }] },
])('refuses ambiguous or incomplete segments instead of losing aggregate usage', async ({ costs }) => {
  const fake = tokenAdapter();
  const send = fake.adapter.send;
  fake.adapter.send = async (session, turn) => ({
    ...(await send(session, turn)),
    segments: costs.map((cost) => ({ type: 'text' as const, text: 'ok', cost })),
  });
  await expect(campaign(fake.adapter, { prices, budgetUsd: 1 })).rejects.toThrow(/Budget cannot/);
  expect(fake.calls()).toBe(1);
});

it('preserves reported segment dollars when aggregate tokens are also present', async () => {
  const fake = tokenAdapter();
  const send = fake.adapter.send;
  fake.adapter.send = async (session, turn) => ({
    ...(await send(session, turn)),
    segments: [{ type: 'text', text: 'ok', cost: { usd: 0.01 } }],
  });
  const outcomes = await campaign(fake.adapter, { prices, budgetUsd: 1 });
  expect(outcomes[0]?.run?.cost).toBeCloseTo(0.02, 10);
});
