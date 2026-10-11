import { fileURLToPath } from 'node:url';
import {
  type AdapterCapabilities,
  type AgentAdapter,
  AgentFailure,
  type Campaign,
  type Check,
  type CheckSet,
  type CostUnit,
  type Count,
  type LoadedSpec,
  loadSpecs,
  machineVerdict,
  type Observed,
  type RunFilter,
  type RunResult,
  type Spec,
  type Store,
  validateSpec,
} from '@driftbench/core';
import {
  type AcmeAgent,
  type AcmeStore,
  createAcmeAgent,
  createStore,
} from '../../../../examples/acme/src/index';
import { matchAssertion, type ObservedCache } from '../../src/runner';

/**
 * Test support for the runner. Everything here is INTERIM and test-only: the minimal machine checks stand
 * in for the checks package, the Acme adapter for the function adapter, the memory store for the store.
 */

export const ACME_CONVERSATIONS = fileURLToPath(
  new URL('../../../../examples/acme/specs/conversations', import.meta.url),
);

export async function loadAcmeConversations(): Promise<LoadedSpec[]> {
  const results = await loadSpecs([ACME_CONVERSATIONS]);
  const loaded = results.filter((result): result is LoadedSpec => result.ok);
  if (loaded.length !== results.length) throw new Error('an Acme conversation spec is invalid');
  return loaded;
}

export function acmeSpec(loaded: LoadedSpec[], id: string): Spec {
  const found = loaded.find((entry) => entry.spec.id === id);
  if (!found) throw new Error(`no Acme spec ${id}`);
  return found.spec;
}

/** Parses a spec written in a test; throws on an invalid one. */
export function specOf(raw: unknown): Spec {
  const result = validateSpec(raw);
  if (!result.ok) throw new Error(`invalid test spec: ${JSON.stringify(result.errors)}`);
  return result.spec;
}

// Minimal machine checks, test-only, until the checks package merges.

export const toolsCheck: Check = {
  name: 'tools',
  applies: (ctx) => (ctx.expect.tools?.length ?? 0) > 0,
  evaluate(ctx) {
    return (ctx.expect.tools ?? []).flatMap((tool) => {
      const calls = ctx.observed.toolCalls.filter((call) => call.label === tool.label);
      const counted = countAllows(tool.count, calls.length);
      const verdicts = [
        machineVerdict(
          'tools',
          `${tool.label}.count`,
          counted ? 'pass' : 'fail',
          `${tool.label}: expected ${showCount(tool.count)}, saw ${calls.length}`,
        ),
      ];
      for (const [field, assertion] of Object.entries(tool.input ?? {})) {
        const wrong = calls.filter((call) => !matchAssertion(fieldOf(call.input, field), assertion));
        verdicts.push(
          machineVerdict(
            'tools',
            `${tool.label}.input.${field}`,
            wrong.length === 0 ? 'pass' : 'fail',
            wrong.length === 0
              ? `${tool.label}.${field} holds ${JSON.stringify(assertion)} on ${calls.length} calls`
              : `${tool.label}.${field} is ${JSON.stringify(fieldOf(wrong[0]?.input, field))}, expected ${JSON.stringify(assertion)}`,
          ),
        );
      }
      return verdicts;
    });
  },
};

export const mustCheck: Check = {
  name: 'must',
  applies: (ctx) => (ctx.expect.must?.length ?? 0) > 0,
  evaluate: (ctx) =>
    (ctx.expect.must ?? []).map((pattern, index) => {
      const found = new RegExp(pattern, 'm').test(ctx.observed.text);
      return machineVerdict(
        'must',
        String(index),
        found ? 'pass' : 'fail',
        `/${pattern}/ ${found ? 'matched' : 'is missing'}`,
      );
    }),
};

export const mustNotCheck: Check = {
  name: 'must_not',
  applies: (ctx) => (ctx.expect.must_not?.length ?? 0) > 0,
  evaluate: (ctx) =>
    (ctx.expect.must_not ?? []).map((pattern, index) => {
      const found = new RegExp(pattern, 'm').test(ctx.observed.text);
      return machineVerdict(
        'must_not',
        String(index),
        found ? 'fail' : 'pass',
        `/${pattern}/ ${found ? 'is present' : 'is absent'}`,
      );
    }),
};

export const stageCheck: Check = {
  name: 'stage',
  applies: (ctx) => ctx.expect.stage !== undefined,
  evaluate(ctx) {
    const seen = ctx.observed.runtime?.stages?.at(-1)?.name;
    return [
      machineVerdict(
        'stage',
        String(ctx.expect.stage),
        seen === ctx.expect.stage ? 'pass' : 'fail',
        `expected ${ctx.expect.stage}, the runtime reports ${seen ?? 'no stage'}`,
      ),
    ];
  },
};

export const minimalChecks: CheckSet = [toolsCheck, mustCheck, mustNotCheck, stageCheck];

function countAllows(count: Count | undefined, seen: number): boolean {
  if (count === undefined) return seen >= 1;
  if (typeof count === 'number') return seen === count;
  return (count.min === undefined || seen >= count.min) && (count.max === undefined || seen <= count.max);
}

function showCount(count: Count | undefined): string {
  if (count === undefined) return 'at least 1';
  if (typeof count === 'number') return `exactly ${count}`;
  return `${count.min ?? 0} to ${count.max ?? 'any'}`;
}

function fieldOf(input: unknown, field: string): unknown {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)[field]
    : undefined;
}

// The Acme agent behind a minimal function adapter, test-only, until the adapters lane merges.

export type AcmeAdapter = AgentAdapter & {
  calls: { open: number; send: number; close: number; endState: number };
  stores: AcmeStore[];
};

export type AcmeAdapterOptions = {
  /** Wraps the agent, for example to break it on purpose. */
  wrap?: (agent: AcmeAgent) => AcmeAgent;
  capabilities?: Partial<AdapterCapabilities>;
};

export function acmeAdapter(options: AcmeAdapterOptions = {}): AcmeAdapter {
  const calls = { open: 0, send: 0, close: 0, endState: 0 };
  const stores: AcmeStore[] = [];
  type State = { store: AcmeStore; agent: AcmeAgent };
  return {
    id: 'function',
    version: 'test-acme-1',
    calls,
    stores,
    capabilities: () => ({
      variants: false,
      seedPrefix: true,
      toolStubs: true,
      trace: false,
      sandbox: false,
      endState: true,
      deterministic: true,
      ...options.capabilities,
    }),
    async open(given) {
      calls.open += 1;
      const store = createStore();
      stores.push(store);
      const agent = createAcmeAgent(store);
      const state: State = { store, agent: options.wrap ? options.wrap(agent) : agent };
      return {
        id: `acme-${calls.open}`,
        adapter: 'function',
        target: given.target,
        given,
        history: structuredClone(given.prefix),
        state,
      };
    },
    async send(session, turn) {
      calls.send += 1;
      return (session.state as State).agent.respond(
        structuredClone(session.history),
        structuredClone(turn.given.world),
      );
    },
    async endState(session, source) {
      calls.endState += 1;
      const label = /^tool:(.+)$/.exec(source)?.[1];
      if (label === undefined) throw new AgentFailure(`unknown end-state source ${source}`);
      return (session.state as State).store.payloads.filter((payload) => payload.tool === label).at(-1)
        ?.input;
    },
    async close() {
      calls.close += 1;
    },
  };
}

/** Breaks the agent on purpose: every reply is changed by `change`. */
export function broken(change: (observed: Observed) => void) {
  return (agent: AcmeAgent): AcmeAgent => ({
    async respond(messages, world) {
      const observed = await agent.respond(messages, world);
      change(observed);
      return observed;
    },
  });
}

/** A known-bad agent: it drops the first tool call of every block, the call and its result. */
export const dropsFirstToolCall = broken((observed) => {
  const [first] = observed.toolCalls;
  if (!first) return;
  observed.toolCalls = observed.toolCalls.slice(1);
  observed.segments = observed.segments.filter(
    (segment) =>
      !((segment.type === 'tool_call' || segment.type === 'tool_result') && segment.id === first.id),
  );
});

/** An agent that answers every block with the same text and does nothing else. */
export function echoAdapter(text = 'ok'): AgentAdapter & { opened: Array<{ prefix: unknown[] }> } {
  const opened: Array<{ prefix: unknown[] }> = [];
  return {
    id: 'echo',
    version: '1',
    opened,
    capabilities: () => ({
      variants: false,
      seedPrefix: true,
      toolStubs: false,
      trace: false,
      sandbox: false,
      endState: false,
      deterministic: true,
    }),
    async open(given) {
      opened.push({ prefix: structuredClone(given.prefix) });
      return {
        id: `echo-${opened.length}`,
        adapter: 'echo',
        target: given.target,
        given,
        history: structuredClone(given.prefix),
      };
    },
    async send() {
      return { segments: [{ type: 'text', text }], text, toolCalls: [], cost: { usd: 0 }, latencyMs: 0 };
    },
    async close() {},
  };
}

// A cache and a store held in memory, test-only.

export type MemoryCache = ObservedCache & { entries: Map<string, Observed>; gets: number; puts: number };

export function memoryCache(): MemoryCache {
  const entries = new Map<string, Observed>();
  const cache = {
    entries,
    gets: 0,
    puts: 0,
    async cacheGet(key: string) {
      cache.gets += 1;
      return entries.get(key);
    },
    async cachePut(key: string, observed: Observed) {
      cache.puts += 1;
      entries.set(key, structuredClone(observed));
    },
  };
  return cache;
}

export class MemoryStore implements Store {
  readonly specs: LoadedSpec[] = [];
  readonly campaigns = new Map<string, Campaign>();
  readonly runs: Array<{ campaignId: string; run: RunResult }> = [];
  readonly cache = new Map<string, Observed>();
  readonly units: CostUnit[] = [];

  async putSpec(spec: LoadedSpec) {
    this.specs.push(spec);
  }
  async getSpec(id: string, hash: string) {
    return this.specs.find((entry) => entry.spec.id === id && entry.hash === hash);
  }
  async putCampaign(campaign: Campaign) {
    this.campaigns.set(campaign.campaignId, campaign);
  }
  async getCampaign(campaignId: string) {
    return this.campaigns.get(campaignId);
  }
  async putRun(campaignId: string, run: RunResult) {
    this.runs.push({ campaignId, run: structuredClone(run) });
  }
  async getRun(runId: string) {
    return this.runs.find((entry) => entry.run.runId === runId)?.run;
  }
  async listRuns(filter: RunFilter = {}) {
    return this.runs
      .filter(
        ({ campaignId, run }) =>
          (filter.campaignId === undefined || campaignId === filter.campaignId) &&
          (filter.status === undefined || run.status === filter.status),
      )
      .map((entry) => entry.run);
  }
  async cacheGet(key: string) {
    return this.cache.get(key);
  }
  async cachePut(key: string, observed: Observed) {
    this.cache.set(key, observed);
  }
  async putUnit(unit: CostUnit) {
    this.units.push(unit);
  }
  async listUnits(adapter?: string) {
    return this.units.filter((unit) => adapter === undefined || unit.adapter === adapter);
  }
  async exportCampaign(): Promise<string> {
    throw new Error('not used in these tests');
  }
  async close() {}
}

/** The failing gating verdicts of a run, for test messages. */
export function failures(run: RunResult): string[] {
  return run.blocks.flatMap((block) =>
    block.verdicts
      .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
      .map((verdict) => `block ${block.index}: ${verdict.id}: ${verdict.evidence}`),
  );
}
