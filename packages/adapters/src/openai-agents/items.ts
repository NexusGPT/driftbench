import { isPlainObject, type Message, type Segment } from '@agent-nexus/driftbench-core';
import { errorOf, outputText, readToolText, type ToolLabels, type ToolOutcome } from '../anthropic/common';
import { contentText, HistoryCompiler, parseArguments } from '../shared';

/**
 * The slice of the OpenAI Agents SDK the adapter speaks, mirrored from `@openai/agents` 0.20.0: a runner
 * (`new Runner()`, or anything with its `run(agent, input, options)`), the input items it takes, and the
 * run items of a `RunResult` it reads. Only the fields the adapter writes or reads are named.
 */

/** An input item: a message, a function call, or a function call result, in the SDK's protocol shape. */
export type AgentInputItemLike =
  | { role: 'user' | 'system'; content: string }
  | { role: 'assistant'; status: 'completed'; content: { type: 'output_text'; text: string }[] }
  | { type: 'function_call'; callId: string; name: string; arguments: string; status: 'completed' }
  | {
      type: 'function_call_result';
      callId: string;
      name: string;
      status: 'completed';
      output: { type: 'text'; text: string };
    };

/** One item of `RunResult.newItems`: its `type`, the protocol `rawItem`, and the fields some types add. */
export type RunItemLike = {
  type: string;
  rawItem?: unknown;
  /** `tool_call_output_item`: the value the tool returned. */
  output?: unknown;
  agent?: { name?: string };
  /** `handoff_output_item`: the agent handing over and the one taking over. */
  sourceAgent?: { name?: string };
  targetAgent?: { name?: string };
};

export type GuardrailResultLike = {
  guardrail?: { name?: string };
  output?: { tripwireTriggered?: boolean };
};

/** What the adapter reads from a run: the new items, the model responses' usage, the guardrail results. */
export type RunResultLike = {
  newItems: readonly RunItemLike[];
  rawResponses?: readonly { usage?: { inputTokens?: number; outputTokens?: number } }[];
  inputGuardrailResults?: readonly GuardrailResultLike[];
  outputGuardrailResults?: readonly GuardrailResultLike[];
  /** The agent the run ended with: the one a handoff passed to, else the one it started from. */
  lastAgent?: { name?: string };
};

/** The options the adapter passes to `run`. */
export type RunOptionsLike = { maxTurns?: number; context?: unknown; signal?: AbortSignal };

/** The runner the adapter calls: `new Runner()` from `@openai/agents`, or a fake with the same shape. */
export type RunnerLike = {
  // biome-ignore lint/suspicious/noExplicitAny: the SDK's run is generic over its agent and context types.
  run(agent: any, input: AgentInputItemLike[], options?: RunOptionsLike): PromiseLike<RunResultLike>;
};

/**
 * The session history as SDK input items. A recorded tool call becomes a `function_call` item and a
 * `function_call_result` item (the output as JSON text, an error as `{"error": "..."}`), then the reply
 * text as an assistant message, when there is one. A `tool` message (a free tool note with no call id)
 * becomes user text.
 */
export function toInputItems(history: readonly Message[], labels: ToolLabels): AgentInputItemLike[] {
  const items: AgentInputItemLike[] = [];
  const compiler = new HistoryCompiler({ fallback: (n) => `call_h${n}` });
  for (const message of history) {
    if (message.role === 'user' || message.role === 'tool') {
      items.push({ role: 'user', content: message.content });
      continue;
    }
    if (message.role === 'system') {
      items.push({ role: 'system', content: message.content });
      continue;
    }
    for (const call of compiler.calls(message)) {
      const callId = call.id as string;
      items.push({
        type: 'function_call',
        callId,
        name: labels.name(call.label),
        arguments: JSON.stringify(call.input ?? {}),
        status: 'completed',
      });
      const text =
        call.result.kind === 'error'
          ? JSON.stringify({ error: call.result.message })
          : outputText(call.result.value);
      items.push({
        type: 'function_call_result',
        callId,
        name: labels.name(call.label),
        status: 'completed',
        output: { type: 'text', text },
      });
    }
    if (message.content !== '') {
      items.push({
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: message.content }],
      });
    }
  }
  return items;
}

/** What the new items of one run come to: segments in order, and the agents a handoff passed to. */
export type MappedRun = { segments: Segment[]; handoffs: string[] };

/**
 * The new items of a run as segments, in order.
 *
 * - `message_output_item`: its `output_text` parts (and a `refusal`) as one text segment.
 * - `tool_call_item`: a `function_call` is a tool call named by its function, with its parsed arguments; a
 *   hosted tool call (web search, file search, code) is a tool call named by its type, with its output as
 *   its result when the item carries one.
 * - `tool_call_output_item`: the result of the call with that `callId`. A value with a single `error` is
 *   the call's error.
 * - `handoff_call_item` and `handoff_output_item`: the transfer call and its result, `{ agent }`, the agent
 *   taking over.
 * - `tool_approval_item`: the call waiting for approval, closed with an error saying so.
 * - Reasoning and other items carry nothing the customer sees.
 */
export function mapItems(items: readonly RunItemLike[], toolLabels: ToolLabels): MappedRun {
  const segments: Segment[] = [];
  const handoffs: string[] = [];
  const labels = new Map<string, string>();
  let unnamed = 0;
  const call = (raw: Record<string, unknown>, label: string, input: unknown): string => {
    const id =
      typeof raw.callId === 'string' ? raw.callId : typeof raw.id === 'string' ? raw.id : `item-${++unnamed}`;
    labels.set(id, label);
    segments.push({ type: 'tool_call', id, label, input });
    return id;
  };
  const result = (id: string, label: string, outcome: ToolOutcome) => {
    segments.push(
      outcome.error !== undefined
        ? { type: 'tool_result', id, label, output: null, error: outcome.error }
        : { type: 'tool_result', id, label, output: outcome.output },
    );
  };

  for (const item of items) {
    const raw = isPlainObject(item.rawItem) ? item.rawItem : {};
    switch (item.type) {
      case 'message_output_item': {
        const text = messageText(raw.content);
        if (text !== '') segments.push({ type: 'text', text });
        break;
      }
      case 'tool_call_item': {
        if (raw.type === 'function_call') {
          call(raw, toolLabels.label(String(raw.name ?? 'function')), parseArguments(raw.arguments));
          break;
        }
        const label = String(raw.name ?? raw.type ?? 'hosted_tool');
        const id = call(
          raw,
          label,
          raw.arguments === undefined ? (raw.action ?? null) : parseArguments(raw.arguments),
        );
        if (raw.output !== undefined) result(id, label, readOutput(raw.output));
        break;
      }
      case 'tool_call_output_item': {
        const id = typeof raw.callId === 'string' ? raw.callId : `item-${++unnamed}`;
        const label = labels.get(id) ?? toolLabels.label(String(raw.name ?? 'function'));
        if (!segments.some((segment) => segment.type === 'tool_result' && segment.id === id)) {
          result(id, label, readOutput(item.output !== undefined ? item.output : raw.output));
        }
        break;
      }
      case 'handoff_call_item':
        call(raw, String(raw.name ?? 'handoff'), parseArguments(raw.arguments));
        break;
      case 'handoff_output_item': {
        const id = typeof raw.callId === 'string' ? raw.callId : `item-${++unnamed}`;
        const agent = item.targetAgent?.name ?? null;
        result(id, labels.get(id) ?? String(raw.name ?? 'handoff'), { output: { agent } });
        if (agent !== null) handoffs.push(agent);
        break;
      }
      case 'tool_approval_item': {
        // The call usually came as its own tool_call_item; the approval closes it, waiting, with an error.
        const known = typeof raw.callId === 'string' && labels.has(raw.callId) ? raw.callId : undefined;
        const id = known ?? call(raw, String(raw.name ?? raw.type ?? 'tool'), parseArguments(raw.arguments));
        result(id, labels.get(id) ?? 'tool', {
          error: 'the run stopped to wait for an approval of this call',
        });
        break;
      }
      default:
        break;
    }
  }
  return { segments, handoffs };
}

/** The customer-visible text of an assistant message: its output text and refusal parts. */
function messageText(content: unknown): string {
  if (!Array.isArray(content)) return contentText(content);
  return content
    .flatMap((part: unknown) => {
      if (!isPlainObject(part)) return [];
      if (part.type === 'output_text' && typeof part.text === 'string') return [part.text];
      if (part.type === 'refusal' && typeof part.refusal === 'string') return [part.refusal];
      return [];
    })
    .join('');
}

/** A tool output: JSON text is parsed, a `{ type: 'text', text }` part is read as its text. */
function readOutput(value: unknown): ToolOutcome {
  if (typeof value === 'string') return readToolText(value);
  if (isPlainObject(value) && value.type === 'text' && typeof value.text === 'string')
    return readToolText(value.text);
  return errorOf(value);
}
