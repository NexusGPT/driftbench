import {
  type AdapterCapabilities,
  type AgentAdapter,
  AgentFailure,
  contentHash,
  copyHistory,
  isPlainObject,
  type ResolvedGiven,
  type Segment,
  type Session,
  type Turn,
} from '@agent-nexus/driftbench-core';
import {
  addUsage,
  answerTool,
  callModel,
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
  type SdkTool,
  type SdkTools,
  stepCap,
  WireNames,
} from '../anthropic/common';
import { type ChatMessage, readCompletion, toChatMessages } from '../http/chat';

/**
 * The litellm adapter: an agent whose model runs behind a LiteLLM proxy, or any OpenAI-compatible chat
 * completions endpoint, reached through an injected client: `new OpenAI({ baseURL, apiKey })` from the
 * `openai` package pointed at the proxy, or any object with its `chat.completions.create` shape.
 *
 * The adapter closes the agent loop itself, as the anthropic adapter does: while a completion asks for
 * tools, it answers each call (a forced result or error from `world.tools` first, else the tool's own
 * `run`), sends the `tool` messages back, and asks again, up to a step cap. Each completion is one model
 * call under the shared retry policy; the client's own retries are turned off for the call
 * (`maxRetries: 0`), so a 429 or a 5xx is retried once, by the policy, and recorded.
 *
 * The proxy routes `model` (such as `anthropic/claude-sonnet-5-5`) to a provider; the model each answer
 * names is kept in `raw.models`, the finish reason of each call in `raw.finishReasons`.
 */

export const LITELLM_ADAPTER_VERSION = '0.1.1';

/** The body of one chat completion call, the OpenAI shape LiteLLM speaks. */
export type ChatCompletionParams = {
  model: string;
  messages: ChatMessage[];
  tools?: {
    type: 'function';
    function: { name: string; description?: string; parameters: Record<string, unknown> };
  }[];
  max_tokens?: number;
};

/** The client the adapter calls: the `openai` package's client, or a fake with its shape. */
export type OpenAIChatClientLike = {
  chat: {
    completions: {
      create(body: ChatCompletionParams, options?: { maxRetries?: number }): PromiseLike<unknown>;
    };
  };
};

export type LitellmAdapterOptions = RetryOption & {
  client: OpenAIChatClientLike;
  /** The model name the proxy routes, such as `openai/gpt-5` or a model group of its config. */
  model: string;
  tools?: SdkTools;
  system?: string;
  /** `max_tokens` of each call; unset leaves the model's default. */
  maxTokens?: number;
  /** The most model calls one block may take. Default 8; a block's `budget.steps` lowers it. */
  maxSteps?: number;
  sideEffects?: readonly string[];
  deterministic?: boolean;
  version?: string;
};

type LitellmState = SdkState & { readonly kind: 'litellm'; tools: ReadonlyMap<string, SdkTool> };

/** Function names the OpenAI shape accepts: letters, digits, underscore and dash, 64 at most. */
const OPENAI_NAME = /[a-zA-Z0-9_-]/;

export function litellmAdapter(options: LitellmAdapterOptions): AgentAdapter {
  const id = 'litellm';
  const maxSteps = options.maxSteps ?? 8;
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
    version:
      options.version ??
      `${LITELLM_ADAPTER_VERSION}+${contentHash({ model: options.model, system: options.system ?? null })}`,
    capabilities: () => ({ ...capabilities }),

    async open(given: ResolvedGiven) {
      // Validate and freeze before user-supplied setup receives the Given.
      copyHistory(given.prefix);
      const list = typeof options.tools === 'function' ? options.tools(given) : (options.tools ?? []);
      return openSession(id, given, {
        kind: 'litellm',
        closed: false,
        payloads: new Map(),
        tools: new Map(list.map((tool) => [tool.name, tool])),
      } satisfies LitellmState);
    },

    async send(session: Session, turn: Turn) {
      const history = copyHistory(session.history);
      const state = ownState<LitellmState>(session, id, 'litellm');
      const names = new WireNames(state.tools.keys(), OPENAI_NAME);
      const messages: ChatMessage[] = [
        ...(options.system ? [{ role: 'system', content: options.system }] : []),
        ...toChatMessages(history).map((message) =>
          message.tool_calls
            ? {
                ...message,
                tool_calls: message.tool_calls.map((call) => ({
                  ...call,
                  function: { ...call.function, name: names.wire(call.function.name) },
                })),
              }
            : message,
        ),
      ];
      const tools = [...state.tools.values()].map((tool) => ({
        type: 'function' as const,
        function: {
          name: names.wire(tool.name),
          ...(tool.description === undefined ? {} : { description: tool.description }),
          parameters: tool.inputSchema ?? { type: 'object' },
        },
      }));
      const cap = stepCap(maxSteps, turn.budget?.steps);
      const policy = policyOf(turn, session, options);
      const context = {
        sessionId: session.id,
        blockIndex: turn.index,
        world: turn.given.world,
        vars: turn.given.vars,
      };

      const segments: Segment[] = [];
      const finishReasons: (string | null)[] = [];
      const models: string[] = [];
      const usage = newUsage();
      let latencyMs = 0;
      for (let step = 1; ; step++) {
        const body: ChatCompletionParams = {
          model: options.model,
          messages,
          ...(tools.length === 0 ? {} : { tools }),
          ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
        };
        const started = performance.now();
        const answer = await callModel(
          `chat.completions.create (${options.model}) on block ${turn.index}`,
          () => options.client.chat.completions.create(structuredClone(body), { maxRetries: 0 }),
          policy,
          options,
        );
        const callMs = Math.round(performance.now() - started);
        latencyMs += callMs;
        const completion = readCompletion(answer);
        if (!completion) {
          throw new AgentFailure(`${options.model} answered block ${turn.index} with no choices[0].message`);
        }
        const choice = isPlainObject(answer) && Array.isArray(answer.choices) ? answer.choices[0] : undefined;
        finishReasons.push(
          isPlainObject(choice) && typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
        );
        if (isPlainObject(answer) && typeof answer.model === 'string') models.push(answer.model);
        const cost = addUsage(usage, completion.usage?.inputTokens, completion.usage?.outputTokens);
        const take = measureOnce({ latencyMs: callMs, ...(cost ? { cost } : {}) });
        const { content, toolCalls: asked } = completion.message;
        if (content !== '') segments.push({ type: 'text', text: content, ...take() });
        if (asked.length === 0) break;
        if (step >= cap) {
          throw new AgentFailure(
            `the agent still asked for ${asked.map((call) => names.label(call.name)).join(', ')} after ${cap} model calls on block ${turn.index}`,
          );
        }
        const calls = asked.map((call, index) => ({
          ...call,
          id: call.id ?? `call-${turn.index}-${step}-${index + 1}`,
        }));
        messages.push({
          role: 'assistant',
          content: content === '' ? null : content,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        });
        for (const call of calls) {
          const label = names.label(call.name);
          segments.push({ type: 'tool_call', id: call.id, label, input: call.arguments, ...take() });
          const { outcome, latencyMs: toolMs } = await answerTool(
            label,
            call.arguments,
            state.tools,
            context,
          );
          if (outcome.error !== undefined) {
            segments.push({
              type: 'tool_result',
              id: call.id,
              label,
              output: null,
              error: outcome.error,
              latencyMs: toolMs,
            });
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ error: outcome.error }),
            });
          } else {
            segments.push({
              type: 'tool_result',
              id: call.id,
              label,
              output: outcome.output,
              latencyMs: toolMs,
            });
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify(outcome.output ?? null),
            });
          }
        }
      }
      const observed = observedOf(segments, usage, latencyMs, `the ${options.model} agent`, {
        raw: { finishReasons, models },
      });
      recordPayloads(state, turn.index, observed.toolCalls, sideEffects);
      return observed;
    },

    async endState(session, source) {
      const state = ownState<LitellmState>(session, id, 'litellm');
      if (options.sideEffects === undefined) {
        throw new Error('the litellm adapter names no sideEffects tools, so it records no payload');
      }
      return readPayloads(payloadLog(state), source, id);
    },

    async close(session) {
      const state = session.state as LitellmState | undefined;
      if (state?.kind !== 'litellm') return;
      state.closed = true;
      state.payloads.clear();
    },
  };
}
