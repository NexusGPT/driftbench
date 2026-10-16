import {
  type AdapterCapabilities,
  type AgentAdapter,
  AgentFailure,
  copyHistory,
  isPlainObject,
  type Message,
  type ResolvedGiven,
  type Segment,
  type Session,
  type Turn,
} from '@agent-nexus/driftbench-core';
import {
  addUsage,
  closeOpenCalls,
  measureOnce,
  newUsage,
  observedOf,
  openSession,
  outputText,
  ownState,
  payloadLog,
  readPayloads,
  recordPayloads,
  type SdkState,
  ToolLabels,
} from '../anthropic/common';
import { bridgeFile, type ExecLike, readBridgeReply, spawnExec } from '../shared/bridge';
import { HistoryCompiler } from '../shared/history';
import { parseArguments } from '../shared/openai';
import { PYDANTIC_AI_BRIDGE } from './bridge-source';

/**
 * The pydantic-ai adapter: a Pydantic AI agent run in a Python process, one per block, through a bridge
 * script shipped with the adapter.
 *
 * Each block sends the session history in Pydantic AI's own message format and the block's user text as
 * the prompt; the bridge runs the agent once (`run_sync`) and prints the run's new messages. The agent
 * runs its own tools, so `world.tools` cannot reach them. The adapter reads the new messages: text parts,
 * tool calls, tool returns, and a retry prompt that answers a tool call (the tool asked the model to try
 * again) as that call's error. Each response's usage is its tokens.
 *
 * The shapes match pydantic-ai 2.55.0 (`ModelMessagesTypeAdapter`, `result.new_messages_json()`).
 */

export const PYDANTIC_AI_ADAPTER_VERSION = '0.1.1';

export type PydanticAiAdapterOptions = {
  /** The agent, as `<module>:<name>`: an Agent, or a function that returns one. */
  agent: string;
  /** The Python interpreter. Default `python3`. */
  python?: string;
  /** Where the process runs, so the agent's module is importable. */
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** The most milliseconds one block may take. Default 600000. */
  timeoutMs?: number;
  /** Runs the process. Default `spawnExec`; tests pass one that plays the bridge. */
  exec?: ExecLike;
  /** The agent's tool names mapped to spec labels, such as `{ coverage_check: 'coverage.check' }`. */
  toolLabels?: Readonly<Record<string, string>>;
  /** The tools that change the world, by spec label. Their inputs are the payloads `endState` reads. */
  sideEffects?: readonly string[];
  deterministic?: boolean;
  /** The version the runner's cache key carries; name the agent's version here. */
  version?: string;
};

type PydanticState = SdkState & { readonly kind: 'pydantic-ai' };

/** A Pydantic AI message part, in its JSON form. */
type Part = Record<string, unknown> & { part_kind: string };
/** A Pydantic AI message, in its JSON form: a request (to the model) or a response (from it). */
type PydanticMessage = { kind: 'request' | 'response'; parts: Part[]; usage?: Record<string, unknown> };

export function pydanticAiAdapter(options: PydanticAiAdapterOptions): AgentAdapter {
  const id = 'pydantic-ai';
  const exec = options.exec ?? spawnExec;
  const labels = new ToolLabels(options.toolLabels);
  const sideEffects = new Set(options.sideEffects ?? []);
  const capabilities: AdapterCapabilities = {
    variants: false,
    seedPrefix: true,
    // The agent runs its own tools; a forced result in world.tools does not reach them.
    toolStubs: false,
    trace: false,
    sandbox: false,
    endState: options.sideEffects !== undefined,
    deterministic: options.deterministic ?? false,
  };

  return {
    id,
    version: options.version ?? PYDANTIC_AI_ADAPTER_VERSION,
    capabilities: () => ({ ...capabilities }),

    async open(given: ResolvedGiven) {
      return openSession(id, given, {
        kind: 'pydantic-ai',
        closed: false,
        payloads: new Map(),
      } satisfies PydanticState);
    },

    async send(session: Session, turn: Turn) {
      const sharedHistory = copyHistory(session.history);
      const state = ownState<PydanticState>(session, id, 'pydantic-ai');
      const { prompt, history } = splitPrompt(sharedHistory);
      const started = performance.now();
      const reply = await exec({
        command: options.python ?? 'python3',
        args: [bridgeFile('pydantic-ai', PYDANTIC_AI_BRIDGE), options.agent],
        input: JSON.stringify({ user_prompt: prompt, message_history: toPydanticMessages(history, labels) }),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        env: { ...(options.cwd === undefined ? {} : { PYTHONPATH: options.cwd }), ...options.env },
        timeoutMs: options.timeoutMs ?? 600_000,
      });
      const latencyMs = Math.round(performance.now() - started);
      const answer = readBridgeReply(reply, `the agent ${options.agent}`);
      if (!Array.isArray(answer)) {
        throw new AgentFailure(
          `the agent ${options.agent} answered block ${turn.index} without a message list`,
        );
      }
      const usage = newUsage();
      const segments = pydanticSegments(answer, labels, usage);
      closeOpenCalls(segments, 'the run ended before the tool answered');
      const first = segments[0];
      if (first) first.latencyMs = latencyMs;
      const observed = observedOf(segments, usage, latencyMs, `the agent ${options.agent}`);
      recordPayloads(state, turn.index, observed.toolCalls, sideEffects);
      return observed;
    },

    async endState(session, source) {
      const state = ownState<PydanticState>(session, id, 'pydantic-ai');
      if (options.sideEffects === undefined) {
        throw new Error('the pydantic-ai adapter names no sideEffects tools, so it records no payload');
      }
      return readPayloads(payloadLog(state), source, id);
    },

    async close(session) {
      const state = session.state as PydanticState | undefined;
      if (state?.kind !== 'pydantic-ai') return;
      state.closed = true;
      state.payloads.clear();
    },
  };
}

/** The block's user messages, joined, as the prompt; the messages before them as the history. */
function splitPrompt(history: readonly Message[]): { prompt: string; history: Message[] } {
  let start = history.length;
  while (start > 0 && history[start - 1]?.role === 'user') start--;
  return {
    prompt: history
      .slice(start)
      .map((message) => message.content)
      .join('\n'),
    history: history.slice(0, start),
  };
}

/**
 * The history in Pydantic AI's message format. A user message is a request with a user prompt part, a
 * system message a system prompt part. A recorded tool call becomes a response with a tool call part, then a
 * request with its tool return (or a retry prompt carrying the error), then the reply text as a response.
 * Messages of one kind in a row merge.
 */
export function toPydanticMessages(history: readonly Message[], labels: ToolLabels): PydanticMessage[] {
  const out: PydanticMessage[] = [];
  const compiler = new HistoryCompiler({ fallback: (n) => `call_h${n}` });
  const push = (kind: PydanticMessage['kind'], parts: Part[]) => {
    if (parts.length === 0) return;
    const last = out.at(-1);
    if (last?.kind === kind) last.parts.push(...parts);
    else out.push({ kind, parts: [...parts] });
  };
  for (const message of history) {
    if (message.role === 'user' || message.role === 'tool') {
      push('request', [{ part_kind: 'user-prompt', content: message.content }]);
      continue;
    }
    if (message.role === 'system') {
      push('request', [{ part_kind: 'system-prompt', content: message.content }]);
      continue;
    }
    const recorded = compiler.calls(message);
    push(
      'response',
      recorded.map((call) => ({
        part_kind: 'tool-call',
        tool_name: labels.name(call.label),
        args: isPlainObject(call.input) ? call.input : {},
        tool_call_id: call.id,
      })),
    );
    push(
      'request',
      recorded.map((call) =>
        call.result.kind === 'error'
          ? {
              part_kind: 'retry-prompt',
              content: call.result.message,
              tool_name: labels.name(call.label),
              tool_call_id: call.id,
            }
          : {
              part_kind: 'tool-return',
              tool_name: labels.name(call.label),
              content: call.result.value,
              tool_call_id: call.id,
            },
      ),
    );
    if (message.content !== '') push('response', [{ part_kind: 'text', content: message.content }]);
  }
  return out;
}

/**
 * New messages as segments, in order. A response adds its text parts and its tool calls, its usage on its
 * first segment. A request adds the result of each tool return, an error when its `outcome` is not
 * `success`, and a retry prompt that names a tool as that call's error. Thinking and user prompt parts add
 * nothing.
 */
export function pydanticSegments(
  messages: readonly unknown[],
  labels: ToolLabels,
  usage = newUsage(),
): Segment[] {
  const segments: Segment[] = [];
  const names = new Map<string, string>();
  let unnamed = 0;
  for (const message of messages) {
    if (!isPlainObject(message) || !Array.isArray(message.parts)) continue;
    if (message.kind === 'response') {
      const counts = isPlainObject(message.usage) ? message.usage : {};
      const cost = addUsage(usage, counts.input_tokens, counts.output_tokens);
      const take = measureOnce(cost ? { cost } : {});
      for (const part of message.parts.filter(isPlainObject)) {
        if (part.part_kind === 'text' && typeof part.content === 'string' && part.content !== '') {
          segments.push({ type: 'text', text: part.content, ...take() });
        } else if (part.part_kind === 'tool-call' || part.part_kind === 'builtin-tool-call') {
          const callId = typeof part.tool_call_id === 'string' ? part.tool_call_id : `call-${++unnamed}`;
          const label = labels.label(String(part.tool_name ?? 'tool'));
          names.set(callId, label);
          segments.push({
            type: 'tool_call',
            id: callId,
            label,
            input: parseArguments(part.args),
            ...take(),
          });
        }
      }
      continue;
    }
    for (const part of message.parts.filter(isPlainObject)) {
      const callId = typeof part.tool_call_id === 'string' ? part.tool_call_id : undefined;
      if (callId === undefined) continue;
      const label = names.get(callId) ?? labels.label(String(part.tool_name ?? 'tool'));
      if (part.part_kind === 'tool-return' || part.part_kind === 'builtin-tool-return') {
        const failed = typeof part.outcome === 'string' && part.outcome !== 'success';
        segments.push(
          failed
            ? { type: 'tool_result', id: callId, label, output: null, error: outputText(part.content) }
            : { type: 'tool_result', id: callId, label, output: part.content ?? null },
        );
      } else if (
        part.part_kind === 'retry-prompt' &&
        part.tool_name !== undefined &&
        part.tool_name !== null
      ) {
        segments.push({
          type: 'tool_result',
          id: callId,
          label,
          output: null,
          error: outputText(part.content),
        });
      }
    }
  }
  return segments;
}
