import { functionAdapter, httpAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type AgentAdapter,
  type BlockResult,
  type CheckSet,
  canonicalJson,
  type Observed,
  type ObservedCache,
  type RetryOptions,
  type RunMode,
  type RunResult,
  runSpec,
  type Spec,
  type Store,
  type TargetRef,
  type UserDriver,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { lastUserText, plantedPerturbingDriver } from '../agent';
import { OPERATORS } from '../family';
import { type Behaviour, type Flow, flow, followerReply, type RawSpec } from '../plant';
import { rngFor } from '../random';

/**
 * The scenario harness of the bank: a planted flow with faults at chosen blocks, the scripted agent behind
 * one of several adapters, and one run through the real runner and the default checks. Every item builds its
 * scenario here, so a fault in the harness shows in many items at once and is found early.
 */

/** The adapters a scenario can reach the agent through. `http-flaky` answers 429 to the first request of
 *  every block, so the runner's retry is on the path. */
export const ADAPTERS = ['function', 'http', 'http-flaky'] as const;
export type AdapterKind = (typeof ADAPTERS)[number];

export const MODES = ['F', 'T', 'P'] as const;

/** Operator classes planted at a block index. */
export type Faults = ReadonlyMap<number, readonly string[]>;

/** A planted flow of one item: its id carries the seed and the item, so no two items share a spec id. */
export function plantedFlow(seed: number, tag: string, blocks?: number): Flow {
  const rng = rngFor(seed, tag);
  const id = `${tag}-${seed}`.replace(/[^A-Za-z0-9._-]/g, '-');
  return flow(rng, id, `Planted flow ${tag}`, 1 + (seed % 97), blocks);
}

/** The behaviours of a flow: the rule follower on every block, with the planted operators applied in order. */
export function behavioursFor(planted: Flow, faults: Faults = new Map()): Map<string, Behaviour> {
  const behaviours = new Map<string, Behaviour>();
  planted.truths.forEach((truth, index) => {
    const classes = faults.get(index) ?? [];
    behaviours.set(planted.texts[index] as string, () =>
      classes.reduce((observed, cls) => {
        const operator = OPERATORS[cls];
        if (!operator) throw new Error(`no operator for the class ${cls}`);
        return operator.apply(observed, truth);
      }, followerReply(truth)),
    );
  });
  return behaviours;
}

function behave(behaviours: ReadonlyMap<string, Behaviour>, text: string, target: TargetRef): Observed {
  const behaviour = behaviours.get(text);
  if (!behaviour)
    throw new Error(`the planted agent has no behaviour for the message "${text.slice(0, 120)}"`);
  return behaviour(target);
}

/** The planted agent behind one adapter. */
export function adapterFor(
  kind: AdapterKind,
  behaviours: ReadonlyMap<string, Behaviour>,
  version = 'bank',
): AgentAdapter {
  if (kind === 'function') {
    type State = { target: TargetRef; log: { tool: string; input: unknown }[] };
    return functionAdapter<State>({
      create: (given) => ({ target: given.target, log: [] }),
      respond: (messages, _world, _vars, state) => {
        const observed = behave(behaviours, lastUserText(messages), state.target);
        for (const call of observed.toolCalls)
          if (call.error === undefined) state.log.push({ tool: call.label, input: call.input });
        return observed;
      },
      // Every successful call is a payload, so `end_state` reads `tool:<label>` from what the agent did.
      payloads: (state) => state.log as never,
      deterministic: true,
      version,
    });
  }
  const failedOnce = new Set<string>();
  return httpAdapter({
    url: 'http://planted.invalid/turn',
    capabilities: { deterministic: true },
    timeoutMs: 5000,
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        session: string;
        turn: number;
        messages: { role: string; content: string | null }[];
        target: TargetRef;
      };
      const key = `${body.session} ${body.turn}`;
      if (kind === 'http-flaky' && !failedOnce.has(key)) {
        failedOnce.add(key);
        return new Response('slow down', { status: 429 });
      }
      const texts: string[] = [];
      for (let index = body.messages.length - 1; index >= 0; index -= 1) {
        const message = body.messages[index];
        if (message?.role !== 'user') break;
        texts.unshift(message.content ?? '');
      }
      const observed = behave(behaviours, texts.join('\n'), body.target);
      return new Response(JSON.stringify(observed), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
}

/** A raw spec through the loader. */
export function loadRaw(raw: RawSpec): Spec {
  const loaded = validateSpec(raw, `bank:${raw.id}`);
  if (!loaded.ok) {
    const errors = loaded.errors.slice(0, 3).map((issue) => `${issue.path}: ${issue.message}`);
    throw new Error(`the bank built a spec the loader refuses, ${raw.id}: ${errors.join('; ')}`);
  }
  return loaded.spec;
}

export const FAST_RETRY: RetryOptions = { retries: 3, baseDelayMs: 0, sleep: async () => {} };

export type RunScenario = {
  mode?: RunMode;
  adapter?: AdapterKind | AgentAdapter;
  repeat?: number;
  perturbationId?: string;
  driver?: UserDriver;
  checks?: CheckSet;
  cache?: ObservedCache;
  store?: Store;
  campaignId?: string;
  target?: TargetRef;
  maxSteps?: number;
  version?: string;
};

/** One run of a raw spec on the planted behaviours, through the real runner and the default checks. */
export async function runScenario(
  raw: RawSpec,
  behaviours: ReadonlyMap<string, Behaviour>,
  options: RunScenario = {},
): Promise<RunResult> {
  const spec = loadRaw(raw);
  const mode = options.mode ?? 'F';
  const adapter =
    typeof options.adapter === 'object'
      ? options.adapter
      : adapterFor(options.adapter ?? 'function', behaviours, options.version);
  const driver =
    options.driver ??
    (mode === 'P' ? plantedPerturbingDriver(spec, options.perturbationId) : createScriptedDriver());
  return runSpec(spec, {
    adapter,
    driver,
    checks: options.checks ?? defaultChecks(),
    mode,
    repeat: options.repeat ?? 0,
    ...(options.perturbationId ? { perturbationId: options.perturbationId } : {}),
    ...(options.cache ? { cache: options.cache } : {}),
    ...(options.store ? { store: options.store, campaignId: options.campaignId ?? 'bank' } : {}),
    ...(options.target ? { target: options.target } : {}),
    ...(options.maxSteps ? { maxSteps: options.maxSteps } : {}),
    retry: FAST_RETRY,
    now: () => new Date('2026-10-11T00:00:00.000Z'),
  });
}

/** The check families of a block's failing gating verdicts, sorted. */
export function failingFamilies(block: BlockResult | undefined): string[] {
  if (!block) return [];
  return [
    ...new Set(
      block.verdicts
        .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
        .map((verdict) => verdict.id.split('.', 1)[0] ?? verdict.id),
    ),
  ].sort();
}

/** The failing verdicts of a run, as `block <index> <id>`, for an item's detail. */
export function failingList(run: RunResult): string {
  const lines = run.blocks.flatMap((block) =>
    block.verdicts
      .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
      .map((verdict) => `block ${block.index} ${verdict.id} ${verdict.outcome}`),
  );
  return lines.length === 0 ? 'no failing verdict' : lines.slice(0, 8).join('; ');
}

/** The run position of each spec block in mode P: positions shift by one from the injected block on. */
export function positionOf(specIndex: number, injectAt: number | undefined): number {
  return injectAt !== undefined && specIndex >= injectAt ? specIndex + 1 : specIndex;
}

/** A small in-memory cache, the shape the runner takes. */
export function memoryCache(): ObservedCache & { size(): number } {
  const map = new Map<string, Observed>();
  return {
    cacheGet: async (key) => map.get(key),
    cachePut: async (key, observed) => {
      map.set(key, structuredClone(observed));
    },
    size: () => map.size,
  };
}

/** The part of a run two runs of the same cell must share: verdicts, passes, drift, status, end state, recovery. */
export function verdictProjection(run: RunResult): string {
  return canonicalJson({
    status: run.status,
    blocks: run.blocks.map((block) => ({
      index: block.index,
      blockId: block.blockId ?? null,
      injected: block.injected ?? false,
      pass: block.pass,
      drift: block.drift,
      verdicts: block.verdicts.map((verdict) => ({
        id: verdict.id,
        outcome: verdict.outcome,
        gating: verdict.gating,
      })),
    })),
    endState: run.endState?.match ?? null,
    succession: run.succession,
    recovery: run.recovery ?? null,
  });
}
