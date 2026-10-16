import {
  type AdapterCapabilities,
  type AgentAdapter,
  AgentFailure,
  contentHash,
  copyHistory,
  isPlainObject,
  type RetryPolicy,
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
  outputText,
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
} from './common';
import {
  ANTHROPIC_NAME,
  type AnthropicClientLike,
  type AnthropicCreateParams,
  type AnthropicMessage,
  type AnthropicMessageParam,
  type AnthropicToolResultBlock,
  toAnthropicMessages,
} from './messages';

export type { SdkTool, SdkTools, ToolContext } from './common';
export type {
  AnthropicClientLike,
  AnthropicCreateParams,
  AnthropicMessage,
  AnthropicMessageParam,
} from './messages';

/**
 * The anthropic adapter: an agent built on the Anthropic Messages API, reached through an injected client
 * (`new Anthropic()` from `@anthropic-ai/sdk`, or any object with its `messages.create` shape).
 *
 * The adapter closes the agent loop itself. Each block sends the session history (the runner has ended it
 * with the block's user messages) with the system prompt and the tools; while the model answers with
 * `tool_use` blocks, the adapter answers each call (a forced result or error from the block's
 * `world.tools` first, else the tool's own `run`), sends the `tool_result` blocks back, and asks again, up
 * to a step cap. The block's Observed holds every text block and every tool call with its result, in order.
 * Each model call runs under the shared retry policy, with the client's own retries off (`maxRetries: 0`).
 */

export const ANTHROPIC_ADAPTER_VERSION = '0.1.1';

export type AnthropicAdapterOptions = RetryOption & {
  /** The client. The adapter calls `client.messages.create(body)` and nothing else. */
  client: AnthropicClientLike;
  /** The model id, such as `claude-sonnet-5-5`. */
  model: string;
  /** The agent's tools, or a factory that builds them per session (a fresh store for each conversation). */
  tools?: SdkTools;
  /** The system prompt. System messages in the history are appended to it. */
  system?: string;
  /** `max_tokens` of each call. Default 1024. */
  maxTokens?: number;
  /** The most model calls one block may take. Default 8; a block's `budget.steps` lowers it. */
  maxSteps?: number;
  /** The tools that change the world. Their inputs are the payloads `endState` reads. Enables `endState`. */
  sideEffects?: readonly string[];
  /** True when the same input gives the same output (a temperature 0 model rarely is). Default false. */
  deterministic?: boolean;
  /** The version the runner's cache key carries. Default the adapter's, with a hash of the model and system prompt. */
  version?: string;
};

type AnthropicState = SdkState & { readonly kind: 'anthropic'; tools: ReadonlyMap<string, SdkTool> };

export function anthropicAdapter(options: AnthropicAdapterOptions): AgentAdapter {
  const id = 'anthropic';
  const maxTokens = options.maxTokens ?? 1024;
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

  async function create(
    body: AnthropicCreateParams,
    block: number,
    policy: RetryPolicy,
  ): Promise<AnthropicMessage> {
    const answer: unknown = await callModel(
      `messages.create (${options.model}) on block ${block}`,
      () => options.client.messages.create(body, { maxRetries: 0 }),
      policy,
      options,
    );
    if (!isPlainObject(answer) || !Array.isArray(answer.content)) {
      throw new AgentFailure(`messages.create (${options.model}) answered without a content list`);
    }
    return answer as AnthropicMessage;
  }

  return {
    id,
    version:
      options.version ??
      `${ANTHROPIC_ADAPTER_VERSION}+${contentHash({ model: options.model, system: options.system ?? null })}`,
    capabilities: () => ({ ...capabilities }),

    async open(given) {
      // Validate and freeze before user-supplied setup receives the Given.
      copyHistory(given.prefix);
      const list = typeof options.tools === 'function' ? options.tools(given) : (options.tools ?? []);
      const state: AnthropicState = {
        kind: 'anthropic',
        closed: false,
        payloads: new Map(),
        tools: new Map(list.map((tool) => [tool.name, tool])),
      };
      return openSession(id, given, state);
    },

    async send(session: Session, turn: Turn) {
      const sharedHistory = copyHistory(session.history);
      const state = ownState<AnthropicState>(session, id, 'anthropic');
      const names = new WireNames(state.tools.keys(), ANTHROPIC_NAME);
      const history = toAnthropicMessages(sharedHistory, names);
      // A prompt version from the registry replaces the configured system prompt.
      const system = [session.target.prompt?.text ?? options.system ?? '', ...history.system]
        .filter((part) => part !== '')
        .join('\n\n');
      const messages: AnthropicMessageParam[] = history.messages;
      const tools = [...state.tools.values()].map((tool) => ({
        name: names.wire(tool.name),
        ...(tool.description === undefined ? {} : { description: tool.description }),
        input_schema: tool.inputSchema ?? { type: 'object' },
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
      const stopReasons: (string | null)[] = [];
      const usage = newUsage();
      let latencyMs = 0;
      for (let step = 1; ; step++) {
        const started = performance.now();
        const answer = await create(
          {
            model: options.model,
            max_tokens: maxTokens,
            messages,
            ...(system === '' ? {} : { system }),
            ...(tools.length === 0 ? {} : { tools }),
          },
          turn.index,
          policy,
        );
        const callMs = Math.round(performance.now() - started);
        latencyMs += callMs;
        const cost = addUsage(usage, answer.usage?.input_tokens, answer.usage?.output_tokens);
        const take = measureOnce({ latencyMs: callMs, ...(cost ? { cost } : {}) });
        stopReasons.push(typeof answer.stop_reason === 'string' ? answer.stop_reason : null);

        const asked: { id: string; label: string; input: unknown }[] = [];
        for (const block of answer.content) {
          if (block.type === 'text' && typeof block.text === 'string' && block.text !== '') {
            segments.push({ type: 'text', text: block.text, ...take() });
          } else if (
            block.type === 'tool_use' &&
            typeof block.id === 'string' &&
            typeof block.name === 'string'
          ) {
            const label = names.label(block.name);
            asked.push({ id: block.id, label, input: block.input ?? null });
            segments.push({ type: 'tool_call', id: block.id, label, input: block.input ?? null, ...take() });
          }
          // Thinking and server tool blocks carry nothing the customer sees; they go back to the API as they came.
        }
        const goesOn = asked.length > 0 || answer.stop_reason === 'pause_turn';
        if (!goesOn) break;
        if (step >= cap) {
          throw new AgentFailure(
            `the agent still asked for ${asked.map((call) => call.label).join(', ') || 'more'} after ${cap} model calls on block ${turn.index}`,
          );
        }
        messages.push({ role: 'assistant', content: answer.content });
        if (asked.length === 0) continue; // pause_turn: the API resumes from its own content.
        const results: AnthropicToolResultBlock[] = [];
        for (const call of asked) {
          const { outcome, latencyMs: toolMs } = await answerTool(
            call.label,
            call.input,
            state.tools,
            context,
          );
          const toolLatency = { latencyMs: toolMs };
          if (outcome.error !== undefined) {
            segments.push({
              type: 'tool_result',
              id: call.id,
              label: call.label,
              output: null,
              error: outcome.error,
              ...toolLatency,
            });
            results.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: outcome.error,
              is_error: true,
            });
          } else {
            segments.push({
              type: 'tool_result',
              id: call.id,
              label: call.label,
              output: outcome.output,
              ...toolLatency,
            });
            results.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: outputText(outcome.output),
            });
          }
        }
        messages.push({ role: 'user', content: results });
      }

      // The stop reason of each model call, in order: `max_tokens` on the last one means a cut reply.
      const observed = observedOf(segments, usage, latencyMs, `the ${options.model} agent`, {
        raw: { stopReasons },
        ...(history.normalizations.length > 0 ? { historyNormalizations: history.normalizations } : {}),
      });
      recordPayloads(state, turn.index, observed.toolCalls, sideEffects);
      return observed;
    },

    async endState(session, source) {
      const state = ownState<AnthropicState>(session, id, 'anthropic');
      if (options.sideEffects === undefined) {
        throw new Error('the anthropic adapter names no sideEffects tools, so it records no payload');
      }
      return readPayloads(payloadLog(state), source, id);
    },

    async close(session) {
      const state = session.state as AnthropicState | undefined;
      if (state?.kind !== 'anthropic') return;
      state.closed = true;
      state.payloads.clear();
    },
  };
}
