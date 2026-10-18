import { isPlainObject, type Message, type Segment } from '@agent-nexus/driftbench-core';
import {
  addUsage,
  errorOf,
  outputText,
  readToolText,
  type ToolLabels,
  type ToolOutcome,
  type Usage,
} from '../anthropic/common';
import { contentText, HistoryCompiler } from '../shared';

/**
 * The slice of LangGraph the adapter speaks, mirrored from `@langchain/langgraph` 1.4.21 with
 * `@langchain/core` 1.2.17: a compiled graph (`invoke`, and `getState` with its `checkpointer`), the
 * message-like dicts it accepts, and the messages its state holds. Only the fields the adapter writes or
 * reads are named; `StateGraph(...).compile()` fits these shapes.
 */

/** A message the adapter sends: a message-like dict LangChain coerces into its message classes. */
export type LangChainMessageLike =
  | { role: 'user' | 'system'; content: string }
  | {
      role: 'assistant';
      content: string;
      tool_calls?: { id: string; name: string; args: Record<string, unknown> }[];
    }
  | { role: 'tool'; content: string; tool_call_id: string; name: string; status?: 'success' | 'error' };

/** A message of the graph's state: a LangChain message instance, or its serialized dict. */
export type GraphMessageLike = {
  content?: unknown;
  tool_calls?: readonly { id?: string; name?: string; args?: unknown }[];
  tool_call_id?: string;
  name?: string;
  status?: string;
  usage_metadata?: { input_tokens?: number; output_tokens?: number };
  getType?: () => string;
  _getType?: () => string;
  type?: string;
  role?: string;
};

/** The config the adapter passes: the thread, and the recursion limit when one is set. */
export type GraphConfigLike = {
  configurable?: { thread_id?: string };
  recursionLimit?: number;
  signal?: AbortSignal;
};

/** The graph the adapter calls: a compiled `StateGraph` (or `createReactAgent`), or a fake with its shape. */
export type GraphLike = {
  invoke(input: { messages: LangChainMessageLike[] }, config?: GraphConfigLike): PromiseLike<unknown>;
  /** Reads the thread's checkpoint; present on a compiled graph, answered only when it has a checkpointer. */
  getState?(config: GraphConfigLike): PromiseLike<{ values?: unknown }>;
  /** The checkpointer the graph was compiled with (`new MemorySaver()`), when it keeps thread state. */
  checkpointer?: unknown;
};

/** LangChain's serialized message classes, as their constructor names read. */
const SERIALIZED_KINDS: Record<string, string> = {
  HumanMessage: 'human',
  HumanMessageChunk: 'human',
  AIMessage: 'ai',
  AIMessageChunk: 'ai',
  ToolMessage: 'tool',
  ToolMessageChunk: 'tool',
  SystemMessage: 'system',
  SystemMessageChunk: 'system',
};

/**
 * A graph message in one readable form, whatever the graph returned: a message instance (its own fields),
 * a dict with `type` or `role` (a remote graph's answer), or LangChain's serialized constructor form
 * (`{ lc: 1, type: 'constructor', id: [..., 'AIMessage'], kwargs }`, what `JSON.stringify` writes).
 */
export function readMessage(message: unknown): { kind: string; fields: GraphMessageLike } {
  if (message === null || typeof message !== 'object') return { kind: 'unknown', fields: {} };
  const m = message as GraphMessageLike & { lc?: unknown; id?: unknown; kwargs?: unknown };
  if (m.lc !== undefined && m.type === 'constructor' && Array.isArray(m.id) && isPlainObject(m.kwargs)) {
    const name = String(m.id.at(-1));
    return { kind: SERIALIZED_KINDS[name] ?? 'unknown', fields: m.kwargs as GraphMessageLike };
  }
  const kind = m.getType?.() ?? m._getType?.() ?? m.type ?? m.role ?? 'unknown';
  return { kind: kind === 'user' ? 'human' : kind === 'assistant' ? 'ai' : kind, fields: m };
}

/** The kind of a graph message: `human`, `ai`, `tool`, `system`, or `unknown`. */
export function kindOf(message: unknown): string {
  return readMessage(message).kind;
}

/**
 * The session history as message-like dicts: a recorded tool call becomes the assistant's `tool_calls`,
 * one `tool` message per call (the output as JSON text, an error with status `error`), then the reply
 * text as an assistant message, when there is one. A `tool` message (a free tool note with no call id)
 * becomes user text.
 */
export function toLangChainMessages(history: readonly Message[], labels: ToolLabels): LangChainMessageLike[] {
  const out: LangChainMessageLike[] = [];
  const compiler = new HistoryCompiler({ fallback: (n) => `call_h${n}` });
  for (const message of history) {
    if (message.role === 'user' || message.role === 'tool') {
      out.push({ role: 'user', content: message.content });
      continue;
    }
    if (message.role === 'system') {
      out.push({ role: 'system', content: message.content });
      continue;
    }
    const recorded = compiler.calls(message);
    if (recorded.length === 0) {
      out.push({ role: 'assistant', content: message.content });
      continue;
    }
    out.push({
      role: 'assistant',
      content: '',
      tool_calls: recorded.map((call) => ({
        id: call.id as string,
        name: labels.name(call.label),
        args: isPlainObject(call.input) ? call.input : {},
      })),
    });
    recorded.forEach((call) => {
      const answer: LangChainMessageLike =
        call.result.kind === 'error'
          ? {
              role: 'tool',
              tool_call_id: call.id as string,
              name: labels.name(call.label),
              content: call.result.message,
              status: 'error',
            }
          : {
              role: 'tool',
              tool_call_id: call.id as string,
              name: labels.name(call.label),
              content: outputText(call.result.value),
            };
      out.push(answer);
    });
    if (message.content !== '') out.push({ role: 'assistant', content: message.content });
  }
  return out;
}

/**
 * Graph messages as segments, in order. An AI message adds its text, then a tool call per `tool_calls`
 * entry, its token usage on its first segment. A tool message adds the result of the call it answers: an
 * error when its status is `error` (the text is the error) or when it holds a single `error`, else its
 * content, parsed when it is JSON. Human and system messages add nothing.
 */
export function mapMessages(messages: readonly unknown[], usage: Usage, toolLabels: ToolLabels): Segment[] {
  const segments: Segment[] = [];
  const labels = new Map<string, string>();
  let unnamed = 0;
  for (const value of messages) {
    const { kind, fields: message } = readMessage(value);
    if (kind === 'ai') {
      const cost = addUsage(
        usage,
        message.usage_metadata?.input_tokens,
        message.usage_metadata?.output_tokens,
      );
      let measure: Pick<Segment, 'cost'> | undefined = cost ? { cost } : undefined;
      const take = () => {
        const taken = measure ?? {};
        measure = undefined;
        return taken;
      };
      const text = contentText(message.content);
      if (text !== '') segments.push({ type: 'text', text, ...take() });
      for (const call of message.tool_calls ?? []) {
        const id = call.id ?? `call-${++unnamed}`;
        const label = toolLabels.label(call.name ?? 'tool');
        labels.set(id, label);
        segments.push({ type: 'tool_call', id, label, input: call.args ?? null, ...take() });
      }
    } else if (kind === 'tool') {
      const id = message.tool_call_id ?? `call-${++unnamed}`;
      const label = labels.get(id) ?? toolLabels.label(message.name ?? 'tool');
      const text = contentText(message.content);
      const outcome: ToolOutcome =
        message.status === 'error'
          ? { error: text }
          : typeof message.content === 'string'
            ? readToolText(text)
            : errorOf(message.content);
      segments.push(
        outcome.error !== undefined
          ? { type: 'tool_result', id, label, output: null, error: outcome.error }
          : { type: 'tool_result', id, label, output: outcome.output },
      );
    }
  }
  return segments;
}
