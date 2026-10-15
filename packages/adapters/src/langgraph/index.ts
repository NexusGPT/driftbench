import {
  type AdapterCapabilities,
  type AgentAdapter,
  AgentFailure,
  copyHistory,
  isPlainObject,
  type Message,
  type Segment,
  type Session,
  type Turn,
} from '@agent-nexus/driftbench-core';
import {
  closeOpenCalls,
  newUsage,
  observedOf,
  openSession,
  ownState,
  payloadLog,
  readPayloads,
  recordPayloads,
  type SdkState,
  ToolLabels,
  vendorError,
} from '../anthropic/common';
import { promptMessages } from '../shared/prompt';
import { type GraphConfigLike, type GraphLike, kindOf, mapMessages, toLangChainMessages } from './messages';

export type { GraphConfigLike, GraphLike, GraphMessageLike, LangChainMessageLike } from './messages';

/**
 * The langgraph adapter: an agent built as a LangGraph graph, a compiled `StateGraph` (or a prebuilt
 * `createReactAgent`) whose state holds a `messages` list.
 *
 * Each block invokes the graph with messages and reads the message list it returns: what came after the
 * block's last user message is the block's turn (AI messages with their text and tool calls, tool messages
 * with the results). The graph runs its own tools.
 *
 * A graph compiled without a checkpointer keeps nothing between calls: every block sends the whole session
 * history. A graph compiled with one keeps the thread itself: the first block of a session sends the whole
 * history (the prefix included), and each later block sends only its own user messages, on the session's
 * thread. `endState` then reads the checkpoint: source `state` is the thread's state values, `state:<key>`
 * one of them.
 */

export const LANGGRAPH_ADAPTER_VERSION = '0.1.1';

export type LanggraphAdapterOptions = {
  /** The compiled graph. The adapter calls `invoke`, `getState` and the checkpointer's `deleteThread`. */
  graph: GraphLike;
  /** The thread id of a session. Default `driftbench-<session id>`, one thread per session. */
  threadId?: (sessionId: string) => string;
  /** The graph's recursion limit (super-steps per invoke). Unset leaves LangGraph's default. */
  recursionLimit?: number;
  /** The graph's tool names mapped to spec labels, such as `{ coverage_check: 'coverage.check' }`. */
  toolLabels?: Readonly<Record<string, string>>;
  /** The tools that change the world, by spec label. Their inputs are the payloads `endState` reads for `tool:` and `*`. */
  sideEffects?: readonly string[];
  /** True when the same input gives the same output. Default false. */
  deterministic?: boolean;
  /** The version the runner's cache key carries; the graph is code, so name its version here. Default the adapter's. */
  version?: string;
};

type GraphState = SdkState & { readonly kind: 'langgraph'; threadId: string; seeded: boolean };

export function langgraphAdapter(options: LanggraphAdapterOptions): AgentAdapter {
  const id = 'langgraph';
  const graph = options.graph;
  const checkpointed = Boolean(graph.checkpointer) && typeof graph.getState === 'function';
  const sideEffects = new Set(options.sideEffects ?? []);
  const labels = new ToolLabels(options.toolLabels);
  const capabilities: AdapterCapabilities = {
    variants: false,
    seedPrefix: true,
    // The graph runs its own tool node; a forced result in world.tools does not reach it.
    toolStubs: false,
    trace: false,
    sandbox: false,
    endState: options.sideEffects !== undefined || checkpointed,
    deterministic: options.deterministic ?? false,
  };

  const config = (state: GraphState): GraphConfigLike => ({
    configurable: { thread_id: state.threadId },
    ...(options.recursionLimit === undefined ? {} : { recursionLimit: options.recursionLimit }),
  });

  return {
    id,
    version: options.version ?? LANGGRAPH_ADAPTER_VERSION,
    capabilities: () => ({ ...capabilities }),

    async open(given) {
      const session = openSession(id, given, {
        kind: 'langgraph',
        closed: false,
        payloads: new Map(),
        threadId: '',
        seeded: false,
      } satisfies GraphState);
      const state = session.state as GraphState;
      state.threadId = options.threadId?.(session.id) ?? `driftbench-${session.id}`;
      return session;
    },

    async send(session: Session, turn: Turn) {
      const history = copyHistory(session.history);
      const state = ownState<GraphState>(session, id, 'langgraph');
      const sent =
        checkpointed && state.seeded
          ? trailingUserMessages(history)
          : promptMessages(history, session.target);
      const started = performance.now();
      let answer: unknown;
      try {
        answer = await graph.invoke({ messages: toLangChainMessages(sent, labels) }, config(state));
      } catch (cause) {
        throw vendorError(cause, `the graph failed on block ${turn.index}`);
      }
      const latencyMs = Math.round(performance.now() - started);
      state.seeded = true;
      if (!isPlainObject(answer) || !Array.isArray(answer.messages)) {
        throw new AgentFailure(`the graph answered block ${turn.index} with no messages list in its state`);
      }
      const all: unknown[] = answer.messages;
      const lastUser = all.findLastIndex((message) => kindOf(message) === 'human');
      const usage = newUsage();
      const segments: Segment[] = mapMessages(all.slice(lastUser + 1), usage, labels);
      const interrupts = answer.__interrupt__;
      if (Array.isArray(interrupts) && interrupts.length > 0) {
        segments.push({ type: 'card', name: 'interrupt', data: interrupts.map(interruptValue) });
      }
      closeOpenCalls(segments, 'the graph stopped before the tool answered');
      const first = segments[0];
      if (first !== undefined) first.latencyMs = latencyMs;
      const observed = observedOf(segments, usage, latencyMs, 'the graph');
      recordPayloads(state, turn.index, observed.toolCalls, sideEffects);
      return observed;
    },

    async endState(session, source) {
      const state = ownState<GraphState>(session, id, 'langgraph');
      const key = /^state(?::(.+))?$/.exec(source);
      if (key) {
        if (!checkpointed || !graph.getState) {
          throw new Error(
            'the langgraph adapter reads state sources only from a graph compiled with a checkpointer',
          );
        }
        let snapshot: { values?: unknown };
        try {
          snapshot = await graph.getState(config(state));
        } catch (cause) {
          throw vendorError(cause, `reading the checkpoint of thread ${state.threadId} failed`);
        }
        const values = snapshot.values;
        if (key[1] === undefined) return values;
        return isPlainObject(values) ? values[key[1]] : undefined;
      }
      return readPayloads(payloadLog(state), source, id);
    },

    async close(session) {
      const state = session.state as GraphState | undefined;
      if (state?.kind !== 'langgraph' || state.closed) return;
      state.closed = true;
      state.payloads.clear();
      const saver = graph.checkpointer as { deleteThread?: (threadId: string) => unknown } | undefined;
      if (checkpointed && state.seeded && typeof saver?.deleteThread === 'function') {
        try {
          await saver.deleteThread(state.threadId);
        } catch (cause) {
          throw vendorError(cause, `deleting thread ${state.threadId} failed`);
        }
      }
    },
  };
}

/** The user messages at the end of the history: the block's own, after the last reply. */
function trailingUserMessages(history: readonly Message[]): Message[] {
  let start = history.length;
  while (start > 0 && history[start - 1]?.role === 'user') start--;
  return history.slice(start);
}

/** An interrupt's payload: its `value` when it is an `Interrupt`, else the item itself. */
function interruptValue(item: unknown): unknown {
  return isPlainObject(item) && 'value' in item ? item.value : item;
}
