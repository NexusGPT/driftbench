import {
  type AdapterCapabilities,
  type AgentAdapter,
  AgentFailure,
  copyHistory,
  decideToolRule,
  deniesCall,
  isPlainObject,
  type Message,
  type ResolvedGiven,
  type RetryPolicy,
  retrying,
  type Segment,
  type Session,
  type ToolRule,
  type Turn,
} from '@agent-nexus/driftbench-core';
import {
  addUsage,
  closeOpenCalls,
  measureOnce,
  newUsage,
  observedOf,
  openSession,
  ownState,
  payloadLog,
  policyOf,
  type RetryOption,
  readPayloads,
  recordPayloads,
  type SdkState,
  stepCap,
  ToolLabels,
  vendorError,
} from '../anthropic/common';
import { HistoryCompiler } from '../shared/history';

/**
 * The vercel-ai adapter: an agent built with the Vercel AI SDK, run by an injected `generateText` (the
 * `ai` package's own) on an injected model (`openai('gpt-5')`, `anthropic(...)`, a gateway model, a mock).
 *
 * Each block calls `generateText` once with the session history as model messages, the system prompt and
 * the tools; the SDK closes the agent loop, running each tool's `execute`, until the model stops or the
 * step cap (`stopWhen`) is reached. The adapter reads `steps[].content`: text, tool calls, tool results and
 * tool errors, in order, and each step's usage.
 *
 * Two things the adapter adds around the SDK. Each tool's `execute` is wrapped so a forced result or error
 * in the block's `world.tools` answers instead (tools are plain objects; the wrap is a new object, the
 * original is never changed). And the model's `doGenerate` is wrapped so each model call runs under the
 * shared retry policy, recorded, with the SDK's own retries off (`maxRetries: 0`).
 *
 * The shapes match the `ai` package 7.0.137 (`generateText`, `ModelMessage`, language model `doGenerate`).
 */

export const VERCEL_AI_ADAPTER_VERSION = '0.1.1';

/** A tool as the SDK takes it: `tool({ description, inputSchema, execute })` is a plain object. */
export type VercelToolLike = Record<string, unknown> & {
  execute?: (input: unknown, options: unknown) => unknown;
};

/** A model message, the history shape `generateText` takes. */
export type ModelMessageLike =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: (
        | { type: 'text'; text: string }
        | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
      )[];
    }
  | {
      role: 'tool';
      content: {
        type: 'tool-result';
        toolCallId: string;
        toolName: string;
        output: { type: 'json'; value: unknown } | { type: 'error-text'; value: string };
      }[];
    };

/** One step of a `generateText` result: its content parts, finish reason and usage. */
export type StepLike = {
  content: readonly Record<string, unknown>[];
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type GenerateTextLike = (options: {
  model: unknown;
  system?: string;
  messages: ModelMessageLike[];
  tools?: Record<string, VercelToolLike>;
  stopWhen: (state: { steps: readonly unknown[] }) => boolean;
  maxRetries: number;
}) => PromiseLike<{ steps: readonly StepLike[] }>;

export type VercelAiAdapterOptions = RetryOption & {
  /** The SDK's `generateText`. */
  generateText: GenerateTextLike;
  /** The language model, such as `openai('gpt-5')`. */
  model: object;
  /** The tools by name, or a factory that builds them per session. */
  tools?: Record<string, VercelToolLike> | ((given: ResolvedGiven) => Record<string, VercelToolLike>);
  system?: string;
  /** The most steps (model calls) one block may take. Default 8; a block's `budget.steps` lowers it. */
  maxSteps?: number;
  /** A tool policy: a denied tool is refused before its execute runs, and the SDK gets the refusal as the tool's error. */
  toolPolicy?: readonly ToolRule[];
  /** The tools' names mapped to spec labels, such as `{ coverage_check: 'coverage.check' }`. */
  toolLabels?: Readonly<Record<string, string>>;
  sideEffects?: readonly string[];
  deterministic?: boolean;
  version?: string;
};

type VercelState = SdkState & { readonly kind: 'vercel-ai'; tools: Record<string, VercelToolLike> };

export function vercelAiAdapter(options: VercelAiAdapterOptions): AgentAdapter {
  const id = 'vercel-ai';
  const maxSteps = options.maxSteps ?? 8;
  const labels = new ToolLabels(options.toolLabels);
  const sideEffects = new Set(options.sideEffects ?? []);
  const capabilities: AdapterCapabilities = {
    variants: false,
    seedPrefix: true,
    toolStubs: true,
    trace: false,
    sandbox: false,
    endState: options.sideEffects !== undefined,
    deterministic: options.deterministic ?? false,
  };

  return {
    id,
    version: options.version ?? VERCEL_AI_ADAPTER_VERSION,
    capabilities: () => ({ ...capabilities }),

    async open(given: ResolvedGiven) {
      // Validate and freeze before user-supplied setup receives the Given.
      copyHistory(given.prefix);
      const tools = typeof options.tools === 'function' ? options.tools(given) : (options.tools ?? {});
      return openSession(id, given, {
        kind: 'vercel-ai',
        closed: false,
        payloads: new Map(),
        tools,
      } satisfies VercelState);
    },

    async send(session: Session, turn: Turn) {
      const history = copyHistory(session.history);
      const state = ownState<VercelState>(session, id, 'vercel-ai');
      const policy = policyOf(turn, session, options);
      const cap = stepCap(maxSteps, turn.budget?.steps);
      const system = [
        options.system ?? '',
        ...history.filter((m) => m.role === 'system').map((m) => m.content),
      ]
        .filter((part) => part !== '')
        .join('\n\n');
      const started = performance.now();
      let result: { steps: readonly StepLike[] };
      try {
        result = await options.generateText({
          model: retriedModel(options.model, policy, options, turn.index),
          ...(system === '' ? {} : { system }),
          messages: toModelMessages(history, labels),
          ...(Object.keys(state.tools).length === 0
            ? {}
            : { tools: stubbed(state.tools, labels, turn, options.toolPolicy) }),
          stopWhen: ({ steps }) => steps.length >= cap,
          maxRetries: 0,
        });
      } catch (cause) {
        throw vendorError(cause, `generateText on block ${turn.index}`);
      }
      const latencyMs = Math.round(performance.now() - started);
      if (!isPlainObject(result) || !Array.isArray(result.steps)) {
        throw new AgentFailure(`generateText answered block ${turn.index} without steps`);
      }
      const usage = newUsage();
      const segments: Segment[] = [];
      const finishReasons: (string | null)[] = [];
      for (const step of result.steps) {
        finishReasons.push(typeof step.finishReason === 'string' ? step.finishReason : null);
        const cost = addUsage(usage, step.usage?.inputTokens, step.usage?.outputTokens);
        segments.push(...stepSegments(step, labels, measureOnce(cost ? { cost } : {})));
      }
      closeOpenCalls(segments, 'the run stopped before the tool answered');
      const first = segments[0];
      if (first) first.latencyMs = latencyMs;
      const observed = observedOf(segments, usage, latencyMs, 'generateText', { raw: { finishReasons } });
      recordPayloads(state, turn.index, observed.toolCalls, sideEffects);
      return observed;
    },

    async endState(session, source) {
      const state = ownState<VercelState>(session, id, 'vercel-ai');
      if (options.sideEffects === undefined) {
        throw new Error('the vercel-ai adapter names no sideEffects tools, so it records no payload');
      }
      return readPayloads(payloadLog(state), source, id);
    },

    async close(session) {
      const state = session.state as VercelState | undefined;
      if (state?.kind !== 'vercel-ai') return;
      state.closed = true;
      state.payloads.clear();
      state.tools = {};
    },
  };
}

/**
 * The model with each `doGenerate` (and `doStream`) call under the shared retry policy. A proxy, so the
 * model keeps its class, its fields and its other methods.
 */
function retriedModel(model: object, policy: RetryPolicy, own: RetryOption, block: number): object {
  return new Proxy(model, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if ((key !== 'doGenerate' && key !== 'doStream') || typeof value !== 'function') return value;
      const name = String((target as { modelId?: unknown }).modelId ?? 'model');
      return (...args: unknown[]) =>
        retrying(`${String(key)} (${name}) on block ${block}`, async () => await value.apply(target, args), {
          policy,
          ...(own.sleep ? { sleep: own.sleep } : {}),
        });
    },
  });
}

/** The tools with each `execute` answering from `world.tools` first, keyed by spec label. */
function stubbed(
  tools: Record<string, VercelToolLike>,
  labels: ToolLabels,
  turn: Turn,
  toolPolicy: readonly ToolRule[] | undefined,
): Record<string, VercelToolLike> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const label = labels.label(name);
      const rule = toolPolicy ? decideToolRule(toolPolicy, label) : undefined;
      if (deniesCall(rule)) {
        // The refusal replaces execute: the tool never runs, and the SDK hands the model this error.
        const why =
          rule?.action === 'ask'
            ? `tool policy rule ${rule.pattern} asks, and no approver answers, so the call is denied`
            : `denied by tool policy rule ${rule?.pattern ?? ''}`;
        return [
          name,
          {
            ...tool,
            execute: async () => {
              throw new Error(why);
            },
          },
        ];
      }
      const forced = turn.given.world.tools?.[label];
      if (forced === undefined || (forced.error === undefined && !('result' in forced))) return [name, tool];
      return [
        name,
        {
          ...tool,
          execute: async () => {
            if (forced.error !== undefined) throw new Error(forced.error);
            return forced.result ?? null;
          },
        },
      ];
    }),
  );
}

/**
 * The history as model messages. A recorded tool call becomes the assistant's `tool-call` part, then a
 * `tool` message with its result (`{ type: 'json' }`, or `{ type: 'error-text' }` for an error), then the
 * reply text. System messages join the system prompt; a `tool` message (a free note) becomes user text.
 */
export function toModelMessages(history: readonly Message[], labels: ToolLabels): ModelMessageLike[] {
  const out: ModelMessageLike[] = [];
  const compiler = new HistoryCompiler({ fallback: (n) => `call_h${n}` });
  for (const message of history) {
    if (message.role === 'system') continue;
    if (message.role === 'user' || message.role === 'tool') {
      out.push({ role: 'user', content: message.content });
      continue;
    }
    const recorded = compiler.calls(message);
    if (recorded.length > 0) {
      out.push({
        role: 'assistant',
        content: recorded.map((call) => ({
          type: 'tool-call' as const,
          toolCallId: call.id as string,
          toolName: labels.name(call.label),
          input: call.input ?? {},
        })),
      });
      out.push({
        role: 'tool',
        content: recorded.map((call) => ({
          type: 'tool-result' as const,
          toolCallId: call.id as string,
          toolName: labels.name(call.label),
          output:
            call.result.kind === 'error'
              ? { type: 'error-text' as const, value: call.result.message }
              : { type: 'json' as const, value: call.result.value },
        })),
      });
    }
    if (message.content !== '')
      out.push({ role: 'assistant', content: [{ type: 'text', text: message.content }] });
  }
  return out;
}

/** One step's content as segments: text, tool calls, tool results and tool errors; reasoning adds nothing. */
function stepSegments(
  step: StepLike,
  labels: ToolLabels,
  take: () => Pick<Segment, 'cost' | 'latencyMs'>,
): Segment[] {
  const segments: Segment[] = [];
  for (const part of step.content) {
    const id = typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
    const label = labels.label(String(part.toolName ?? 'tool'));
    if (part.type === 'text' && typeof part.text === 'string' && part.text !== '') {
      segments.push({ type: 'text', text: part.text, ...take() });
    } else if (part.type === 'tool-call' && id !== undefined) {
      segments.push({ type: 'tool_call', id, label, input: part.input ?? null, ...take() });
    } else if (part.type === 'tool-result' && id !== undefined) {
      segments.push({ type: 'tool_result', id, label, output: part.output ?? null });
    } else if (part.type === 'tool-error' && id !== undefined) {
      const error = part.error instanceof Error ? part.error.message : String(part.error);
      segments.push({ type: 'tool_result', id, label, output: null, error });
    }
  }
  return segments;
}
