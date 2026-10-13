import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type Check,
  type CheckContext,
  type DriverStep,
  type Message,
  RunResult,
  type UserDriver,
} from '@agent-nexus/driftbench-core';
import { bootstrapCI } from '@agent-nexus/driftbench-stats';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import type { AcmeAgent } from '../../../../examples/acme/src/index';
import {
  canonicalGiven,
  canonicalReply,
  compoundingIndex,
  type IntervalFn,
  planCampaign,
  runCampaign,
  runSpec,
} from '../../src/runner';
import { acmeAdapter, acmeSpec, failures, loadAcmeConversations, realAcmeAdapter, specOf } from './support';

const loaded = await loadAcmeConversations();
const driver = createScriptedDriver();
const interval: IntervalFn = (values, clusters) => bootstrapCI(values, { clusters, iterations: 500 });

/** A check that records the context of every block and judges nothing. */
function spy(): Check & { seen: CheckContext[] } {
  const seen: CheckContext[] = [];
  return {
    name: 'spy',
    seen,
    applies: () => true,
    evaluate: (ctx) => {
      seen.push(ctx);
      return [];
    },
  };
}

/**
 * A known-bad agent: right on every block it answers from a canonical prefix, but once it has written three
 * replies of its own (non-empty text) it loses the thread and asks for the email again. In a free-running
 * run that is every block after block 2; a teacher-forced prefix carries no reply text, so it never drifts.
 */
function driftsAfterBlock2(agent: AcmeAgent): AcmeAgent {
  return {
    async respond(messages, world) {
      const observed = await agent.respond(messages, world);
      const own = messages.filter((message) => message.role === 'assistant' && message.content !== '');
      if (own.length >= 3) {
        const text = 'Sorry, let me start again. What is your email address?';
        observed.text = text;
        observed.segments = [
          ...observed.segments.filter((segment) => segment.type !== 'text'),
          { type: 'text', text },
        ];
      }
      return observed;
    },
  };
}

describe('the canonical Given of a teacher-forced block', () => {
  const spec = specOf({
    id: 'canon',
    given: {
      ledger: { lang: 'EN' },
      world: { tools: { lookup: { result: { found: true } } } },
      vars: { channel: 'chat' },
    },
    blocks: [
      {
        user: 'a',
        expect: {
          ledger_add: { name: 'Sam' },
          tools: [
            {
              label: 'lookup',
              count: 2,
              input: { id: 'x-1', kind: { exact: 'plan' }, note: { regex: '^n' } },
            },
          ],
        },
      },
      {
        burst: ['b1', 'b2'],
        given: { world: { tools: { submit: { error: 'queue down' } } }, vars: { clock: 't1' } },
        expect: {
          ledger_add: { plan: 'm' },
          tools: [
            { label: 'submit', count: { min: 1, max: 2 } },
            { label: 'lookup', count: 0 },
          ],
        },
      },
      { user: 'c', expect: { tools: [{ label: 'other' }] } },
      {
        user: 'd',
        given: {
          prefix: [
            { role: 'user', content: 'p' },
            { role: 'assistant', content: 'q' },
          ],
          ledger: { tier: 'gold' },
        },
      },
      { user: 'e' },
    ],
  });

  it('starts block 0 from the spec alone', () => {
    const { state, prefix } = canonicalGiven(spec, 0);
    expect(prefix).toEqual([]);
    expect(state.ledger).toEqual({ lang: 'EN' });
    expect(state.vars).toEqual({ channel: 'chat' });
  });

  it('builds the prefix from the spec: user turns, and replies that carry the expected calls and the forced results', () => {
    const { state, prefix } = canonicalGiven(spec, 2);
    expect(prefix).toEqual([
      { role: 'user', content: 'a' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { label: 'lookup', input: { id: 'x-1', kind: 'plan' }, output: { found: true } },
          { label: 'lookup', input: { id: 'x-1', kind: 'plan' }, output: { found: true } },
        ],
      },
      { role: 'user', content: 'b1' },
      { role: 'user', content: 'b2' },
      { role: 'assistant', content: '', tool_calls: [{ label: 'submit', input: {}, error: 'queue down' }] },
    ]);
    expect(state.ledger).toEqual({ lang: 'EN', name: 'Sam', plan: 'm' });
    expect(state.world.tools).toEqual({
      lookup: { result: { found: true } },
      submit: { error: 'queue down' },
    });
    expect(state.vars).toEqual({ channel: 'chat', clock: 't1' });
  });

  it("restarts from a block's own prefix and keeps the blocks after it", () => {
    expect(canonicalGiven(spec, 3).prefix).toEqual([
      { role: 'user', content: 'p' },
      { role: 'assistant', content: 'q' },
    ]);
    expect(canonicalGiven(spec, 4).prefix).toEqual([
      { role: 'user', content: 'p' },
      { role: 'assistant', content: 'q' },
      { role: 'user', content: 'd' },
      { role: 'assistant', content: '' },
    ]);
    expect(canonicalGiven(spec, 4).state.ledger).toEqual({
      lang: 'EN',
      name: 'Sam',
      plan: 'm',
      tier: 'gold',
    });
  });

  it('records a call without a result when the world forces none, and once without a count', () => {
    expect(canonicalReply({ tools: [{ label: 'other' }] }, {})).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [{ label: 'other', input: {} }],
    });
    expect(canonicalReply({ tools: [{ label: 'other', count: { max: 2 } }] }, {})).toEqual({
      role: 'assistant',
      content: '',
    });
  });
});

describe('runSpec in teacher-forced mode', () => {
  it('opens one session per block, from the canonical prefix, never from the agent history', async () => {
    const spec = acmeSpec(loaded, 'acme-plan-upgrade');
    const adapter = acmeAdapter();
    const watch = spy();
    const run = await runSpec(spec, { adapter, driver, checks: [watch], mode: 'T', repeat: 0 });
    expect(run.status, run.error).toBe('completed');
    expect(run.mode).toBe('T');
    expect(adapter.calls.open).toBe(spec.blocks.length);
    expect(adapter.calls.close).toBe(spec.blocks.length);
    for (const [index, ctx] of watch.seen.entries()) {
      expect(ctx.given.prefix).toEqual(canonicalGiven(spec, index).prefix);
      expect(ctx.history).toEqual([]);
    }
    // The canonical prefix of block 2 holds no reply text: the agent's own words never come back.
    const assistant = watch.seen[2]?.given.prefix.filter((message: Message) => message.role === 'assistant');
    expect(assistant?.map((message) => message.content)).toEqual(['', '']);
    expect(watch.seen[1]?.ledger).toEqual({
      customer: 'existing',
      lang: 'EN',
      customer_id: 'cust-001',
      current_plan: 'mobile-s',
    });
  });

  it('composes the end state over the blocks: the order placed on block 3 is the end state after block 4', async () => {
    const spec = acmeSpec(loaded, 'acme-plan-upgrade');
    const watch = spy();
    const run = await runSpec(spec, {
      adapter: acmeAdapter(),
      driver,
      checks: [watch],
      mode: 'T',
      repeat: 0,
    });
    expect(run.endState).toEqual({ match: true, diff: [] });
    expect(watch.seen[4]?.endState).toEqual({
      type: 'upgrade',
      customer_id: 'cust-001',
      plan_id: 'mobile-l',
    });
    expect(watch.seen.slice(0, 4).every((ctx) => ctx.endState === undefined)).toBe(true);
  });

  it('joins the payload lists for end_state: none', async () => {
    const spec = acmeSpec(loaded, 'acme-off-topic-return');
    const run = await runSpec(spec, { adapter: acmeAdapter(), driver, checks: [], mode: 'T', repeat: 0 });
    expect(run.endState).toEqual({ match: true, diff: [] });
  });

  it.each(loaded.map((entry) => ({ id: entry.spec.id, spec: entry.spec })))(
    '$id passes every block and its end state with the real Acme agent and every default check',
    async ({ spec }) => {
      const run = await runSpec(spec, {
        adapter: realAcmeAdapter(),
        driver,
        checks: defaultChecks(),
        mode: 'T',
        repeat: 0,
      });
      expect(RunResult.safeParse(run).success).toBe(true);
      expect(run.status, run.error).toBe('completed');
      expect(failures(run)).toEqual([]);
      expect(run.blocks).toHaveLength(spec.blocks.length);
      expect(run.endState?.match ?? true).toBe(true);
    },
  );

  it('refuses a block the driver injects', async () => {
    const spec = acmeSpec(loaded, 'acme-plan-upgrade');
    const steps: DriverStep[] = [
      { kind: 'injected', perturbationId: 'billing-aside', stimulus: { user: 'x' }, beforeBlock: 0 },
    ];
    const injecting: UserDriver = {
      id: 'list',
      next: () => steps.shift() ?? { kind: 'stop', reason: 'end' },
    };
    const run = await runSpec(spec, {
      adapter: acmeAdapter(),
      driver: injecting,
      checks: [],
      mode: 'T',
      repeat: 0,
    });
    expect(run.status).toBe('failed');
    expect(run.error).toBe(
      "teacher-forced mode runs the spec's own blocks; the driver list injected billing-aside",
    );
  });

  it('keys the cache by the canonical Given: a second T run replays every block', async () => {
    const entries = new Map<string, unknown>();
    const cache = {
      cacheGet: async (key: string) => entries.get(key) as never,
      cachePut: async (key: string, value: unknown) => {
        entries.set(key, structuredClone(value));
      },
    };
    const spec = acmeSpec(loaded, 'acme-plan-upgrade');
    const first = await runSpec(spec, {
      adapter: acmeAdapter(),
      driver,
      checks: [],
      mode: 'T',
      repeat: 0,
      cache,
    });
    const adapter = acmeAdapter();
    const second = await runSpec(spec, { adapter, driver, checks: [], mode: 'T', repeat: 0, cache });
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(adapter.calls.send).toBe(0);
    expect(second.endState).toEqual(first.endState);
  });
});

describe('the compounding index', () => {
  async function runs(wrap?: (agent: AcmeAgent) => AcmeAgent, repeats = 2): Promise<RunResult[]> {
    const out: RunResult[] = [];
    for (const { spec } of loaded) {
      for (const mode of ['T', 'F'] as const) {
        for (let repeat = 0; repeat < repeats; repeat++) {
          out.push(
            await runSpec(spec, {
              adapter: realAcmeAdapter(wrap),
              driver,
              checks: defaultChecks(),
              mode,
              repeat,
            }),
          );
        }
      }
    }
    return out;
  }

  it('is 0 for the deterministic Acme agent, on every spec, with an interval of [0, 0]', async () => {
    const index = compoundingIndex(await runs(), { interval });
    expect(index.specs).toHaveLength(6);
    for (const line of index.specs) {
      expect(line.index).toBe(0);
      expect(line.passT).toBe(1);
      expect(line.interval).toMatchObject({ estimate: 0, lower: 0, upper: 0 });
    }
    expect(index.overall).toMatchObject({
      blocks: 26,
      index: 0,
      interval: { estimate: 0, lower: 0, upper: 0 },
    });
  });

  it('is positive for an agent that drifts after block 2 in free-running runs only', async () => {
    const index = compoundingIndex(await runs(driftsAfterBlock2), { interval });
    const upgrade = index.specs.find((line) => line.specId === 'acme-plan-upgrade');
    expect(upgrade?.blocks.map((block) => [block.block, block.passT, block.passF])).toEqual([
      [0, 1, 1],
      [1, 1, 1],
      [2, 1, 1],
      [3, 1, 0],
      [4, 1, 0],
    ]);
    expect(upgrade?.index).toBeCloseTo(0.4, 12);
    expect(upgrade?.interval?.estimate).toBeCloseTo(0.4, 12);
    // tool-failure has three blocks: the agent never writes a third reply before its last block ends.
    expect(index.specs.find((line) => line.specId === 'acme-tool-failure')?.index).toBe(0);
    const overall = index.overall;
    if (!overall?.interval) throw new Error('no overall interval');
    expect(overall.index).toBeGreaterThan(0);
    expect(overall.interval.estimate).toBeCloseTo(overall.index, 12);
    expect(overall.interval.lower).toBeGreaterThan(0);
    expect(overall.interval.lower).toBeLessThanOrEqual(overall.index);
    expect(overall.interval.upper).toBeGreaterThanOrEqual(overall.index);
  });

  it('gives one spec no overall interval, whatever its targets: one spec is one cluster', async () => {
    const all = await runs(driftsAfterBlock2);
    const one = all.filter((run) => run.specId === all[0]?.specId);
    const twoTargets = [
      ...one,
      ...one.map((run) => ({ ...run, target: { ...run.target, label: 'second-target' } })),
    ];
    const index = compoundingIndex(twoTargets, { interval });
    expect(index.specs).toHaveLength(2);
    expect(index.overall).toBeDefined();
    expect(index.overall?.interval).toBeUndefined();
  });

  it('pairs blocks by their index in the spec, ignores P runs and needs both modes', async () => {
    const spec = acmeSpec(loaded, 'acme-plan-upgrade');
    const t = await runSpec(spec, { adapter: acmeAdapter(), driver, checks: [], mode: 'T', repeat: 0 });
    expect(compoundingIndex([t]).specs).toEqual([]);
    const f = await runSpec(spec, { adapter: acmeAdapter(), driver, checks: [], mode: 'F', repeat: 0 });
    const p = { ...f, mode: 'P' as const, blocks: f.blocks.map((block) => ({ ...block, pass: false })) };
    // A shorter F run counts only for the blocks it reached.
    const short = {
      ...f,
      repeat: 1,
      blocks: f.blocks.slice(0, 2).map((block) => ({ ...block, pass: false })),
    };
    const index = compoundingIndex([t, f, p, short]);
    expect(index.specs[0]?.blocks.map((block) => [block.block, block.passF, block.runsF])).toEqual([
      [0, 0.5, 2],
      [1, 0.5, 2],
      [2, 1, 1],
      [3, 1, 1],
      [4, 1, 1],
    ]);
    expect(index.specs[0]?.index).toBeCloseTo(0.2, 12);
    expect(index.specs[0]?.interval).toBeUndefined();
  });
});

describe('a campaign in mode T', () => {
  it('plans and runs T cells, and files them', async () => {
    const specs = loaded.map(({ spec, hash }) => ({ spec, hash }));
    const target = { adapter: 'function', agent: 'acme' };
    const plan = planCampaign(specs, [target], ['T', 'F'], 1);
    expect(plan.cells.map((cell) => cell.mode)).toEqual(specs.flatMap(() => ['T', 'F']));
    const store = openMemoryStore();
    await store.putCampaign({
      campaignId: 'c-t',
      specs: specs.map(({ spec, hash }) => ({ id: spec.id, hash })),
      targets: [target],
      modes: ['T', 'F'],
      repeats: { T: 1, F: 1, P: 0 },
      budgetUsd: 0,
      judge: { mode: 'system1', judges: [] },
      createdAt: '2026-10-11T00:00:00.000Z',
    });
    const bySpec = new Map(specs.map(({ spec, hash }) => [`${spec.id}@${hash}`, spec]));
    const outcomes = await runCampaign({
      campaignId: 'c-t',
      cells: plan.cells,
      specFor: (cell) => {
        const spec = bySpec.get(`${cell.specId}@${cell.specHash}`);
        if (!spec) throw new Error(`no spec ${cell.specId}`);
        return spec;
      },
      adapterFor: () => realAcmeAdapter(),
      driver: () => createScriptedDriver(),
      checks: defaultChecks(),
      store,
    });
    expect(outcomes.map((outcome) => outcome.state)).toEqual(plan.cells.map(() => 'pass'));
    const stored = await store.listRuns({ campaignId: 'c-t', mode: 'T' });
    expect(stored).toHaveLength(6);
    expect(compoundingIndex(await store.listRuns({ campaignId: 'c-t' })).overall?.index).toBe(0);
    await store.close();
  });
});
