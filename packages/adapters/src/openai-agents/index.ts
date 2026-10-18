import {
  type AdapterCapabilities,
  type AgentAdapter,
  AgentFailure,
  copyHistory,
  isPlainObject,
  type Observed,
  type ResolvedGiven,
  type RuntimeTrace,
  type Session,
  type Turn,
} from '@agent-nexus/driftbench-core';
import {
  addUsage,
  closeOpenCalls,
  newUsage,
  observedOf,
  openSession,
  ownState,
  payloadLog,
  readPayloads,
  recordPayloads,
  type SdkState,
  stepCap,
  ToolLabels,
  vendorError,
} from '../anthropic/common';
import { promptMessages } from '../shared/prompt';
import {
  type GuardrailResultLike,
  mapItems,
  type RunnerLike,
  type RunResultLike,
  toInputItems,
} from './items';

export type {
  AgentInputItemLike,
  GuardrailResultLike,
  RunItemLike,
  RunnerLike,
  RunOptionsLike,
  RunResultLike,
} from './items';

/**
 * The openai-agents adapter: an agent built with the OpenAI Agents SDK, run by an injected runner
 * (`new Runner()` from `@openai/agents`, or any object with its `run(agent, input, options)` shape).
 *
 * Each block runs the agent once on the session history as input items (the runner has ended it with the
 * block's user messages). The SDK closes the agent loop itself: it calls the model, runs the agent's tools
 * and follows handoffs, up to `maxTurns`. The adapter reads what the run added (`newItems`) into the
 * Observed: message text, tool calls with their outputs, handoffs as transfer calls whose result names the
 * agent taking over (also a stage), guardrails as guards, and the token usage of every model response.
 *
 * The history belongs to the driftbench runner, so the adapter never passes an SDK session: the SDK's own
 * memory would hold a second copy of the conversation. After a handoff, the next block starts from the agent
 * the run ended with (`lastAgent`), as the SDK's own chat loop does; `followHandoffs: false` starts every
 * block from the first agent.
 */

export const OPENAI_AGENTS_ADAPTER_VERSION = '0.1.1';

export type OpenAIAgentsAdapterOptions = {
  /** The runner. The adapter calls `runner.run(agent, items, { maxTurns, context })` and nothing else. */
  runner: RunnerLike;
  /** The agent (`new Agent({ ... })`), or a factory that builds one per session, such as one with a fresh store. */
  agent: unknown | ((given: ResolvedGiven) => unknown);
  /** The most model calls one block may take, the SDK's `maxTurns`. Default 10, the SDK's; `budget.steps` lowers it. */
  maxTurns?: number;
  /** Start each block from the agent the last run ended with, after a handoff. Default true. */
  followHandoffs?: boolean;
  /** The run context handed to the agent's tools and guardrails, built per session. */
  context?: (given: ResolvedGiven) => unknown;
  /** The agent's tool names mapped to spec labels, such as `{ coverage_check: 'coverage.check' }`. */
  toolLabels?: Readonly<Record<string, string>>;
  /** The tools that change the world, by spec label. Their inputs are the payloads `endState` reads. Enables `endState`. */
  sideEffects?: readonly string[];
  /** True when the same input gives the same output. Default false. */
  deterministic?: boolean;
  /** The version the runner's cache key carries; the agent is code, so name its version here. Default the adapter's. */
  version?: string;
};

type AgentsState = SdkState & {
  readonly kind: 'openai-agents';
  /** The agent the next block starts from. */
  agent: unknown;
  /** The agent each block started from, so a retried block starts from the same one. */
  startedFrom: Map<number, unknown>;
  context: unknown;
};

export function openaiAgentsAdapter(options: OpenAIAgentsAdapterOptions): AgentAdapter {
  const id = 'openai-agents';
  const maxTurns = options.maxTurns ?? 10;
  const sideEffects = new Set(options.sideEffects ?? []);
  const labels = new ToolLabels(options.toolLabels);
  const capabilities: AdapterCapabilities = {
    variants: false,
    seedPrefix: true,
    // The SDK runs the agent's tools itself; a forced result in world.tools does not reach them.
    toolStubs: false,
    trace: false,
    sandbox: false,
    endState: options.sideEffects !== undefined,
    deterministic: options.deterministic ?? false,
  };

  return {
    id,
    version: options.version ?? OPENAI_AGENTS_ADAPTER_VERSION,
    capabilities: () => ({ ...capabilities }),

    async open(given) {
      // Validate and freeze before user-supplied setup receives the Given.
      copyHistory(given.prefix);
      const agent =
        typeof options.agent === 'function'
          ? (options.agent as (given: ResolvedGiven) => unknown)(given)
          : options.agent;
      const state: AgentsState = {
        kind: 'openai-agents',
        closed: false,
        payloads: new Map(),
        agent,
        startedFrom: new Map(),
        context: options.context?.(given),
      };
      return openSession(id, given, state);
    },

    async send(session: Session, turn: Turn) {
      const history = copyHistory(session.history);
      const state = ownState<AgentsState>(session, id, 'openai-agents');
      const input = toInputItems(promptMessages(history, session.target), labels);
      const agent = state.startedFrom.has(turn.index) ? state.startedFrom.get(turn.index) : state.agent;
      state.startedFrom.set(turn.index, agent);
      const turns = stepCap(maxTurns, turn.budget?.steps);
      const started = performance.now();
      let result: RunResultLike;
      try {
        result = await options.runner.run(agent, input, {
          maxTurns: turns,
          ...(state.context === undefined ? {} : { context: state.context }),
        });
      } catch (cause) {
        const tripped = tripwire(cause);
        if (tripped === undefined) throw vendorError(cause, `the agent run failed on block ${turn.index}`);
        return observedOf([], newUsage(), Math.round(performance.now() - started), 'the agent run', {
          runtime: { guards: [tripped] },
        });
      }
      const latencyMs = Math.round(performance.now() - started);
      if (!isPlainObject(result) || !Array.isArray(result.newItems)) {
        throw new AgentFailure(`the agent run on block ${turn.index} returned no newItems list`);
      }

      const { segments, handoffs } = mapItems(result.newItems, labels);
      if (handoffs.length > 0 && options.followHandoffs !== false && result.lastAgent)
        state.agent = result.lastAgent;
      closeOpenCalls(segments, 'the run ended before the tool answered');
      const usage = newUsage();
      for (const response of result.rawResponses ?? []) {
        addUsage(usage, response.usage?.inputTokens, response.usage?.outputTokens);
      }
      const first = segments[0];
      if (first !== undefined) first.latencyMs = latencyMs;
      const runtime: RuntimeTrace = {};
      const guards = [...(result.inputGuardrailResults ?? []), ...(result.outputGuardrailResults ?? [])].map(
        guardOf,
      );
      if (guards.length > 0) runtime.guards = guards;
      if (handoffs.length > 0) runtime.stages = handoffs.map((name) => ({ name }));
      const observed: Observed = observedOf(segments, usage, latencyMs, 'the agent run', {
        ...(Object.keys(runtime).length > 0 ? { runtime } : {}),
      });
      recordPayloads(state, turn.index, observed.toolCalls, sideEffects);
      return observed;
    },

    async endState(session, source) {
      const state = ownState<AgentsState>(session, id, 'openai-agents');
      if (options.sideEffects === undefined) {
        throw new Error('the openai-agents adapter names no sideEffects tools, so it records no payload');
      }
      return readPayloads(payloadLog(state), source, id);
    },

    async close(session) {
      const state = session.state as AgentsState | undefined;
      if (state?.kind !== 'openai-agents') return;
      state.closed = true;
      state.payloads.clear();
      state.agent = undefined;
      state.startedFrom.clear();
      state.context = undefined;
    },
  };
}

/** A guardrail result as a guard: `block` when its tripwire fired, `pass` otherwise. */
function guardOf(result: GuardrailResultLike): { name: string; verdict: string } {
  return {
    name: result.guardrail?.name ?? 'guardrail',
    verdict: result.output?.tripwireTriggered === true ? 'block' : 'pass',
  };
}

/**
 * A guardrail whose tripwire stopped the run is the agent's behaviour, not a failure: the SDK throws
 * `InputGuardrailTripwireTriggered` (or the output and tool twins) carrying the guardrail result.
 */
function tripwire(cause: unknown): { name: string; verdict: string } | undefined {
  if (!(cause instanceof Error)) return undefined;
  const names = `${cause.name} ${cause.constructor?.name ?? ''}`;
  if (!/GuardrailTripwireTriggered/.test(names)) return undefined;
  const result = (cause as { result?: GuardrailResultLike }).result;
  return { name: result?.guardrail?.name ?? 'guardrail', verdict: 'block' };
}
