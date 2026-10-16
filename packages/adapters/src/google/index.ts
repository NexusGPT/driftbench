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
import {
  argsOf,
  GOOGLE_NAME,
  type GoogleClientLike,
  type GoogleContent,
  type GoogleGenerateParams,
  type GoogleGenerateResponse,
  type GooglePart,
  toGoogleContents,
} from './contents';

export type {
  GoogleClientLike,
  GoogleContent,
  GoogleGenerateParams,
  GoogleGenerateResponse,
  GooglePart,
} from './contents';

/**
 * The google adapter: an agent built on the Gemini API, reached through an injected client
 * (`new GoogleGenAI({ apiKey })` from `@google/genai`, or any object with its `models.generateContent` shape).
 *
 * The adapter closes the agent loop itself, as the anthropic adapter does. Each block sends the session
 * history as contents, with the system instruction and the function declarations; while the model answers
 * with `functionCall` parts, the adapter answers each call (a forced result or error from the block's
 * `world.tools` first, else the tool's own `run`), sends the `functionResponse` parts back, and asks again,
 * up to a step cap. Thought parts are reasoning, never customer-visible text, and are left out of the text.
 */

export const GOOGLE_ADAPTER_VERSION = '0.1.1';

export type GoogleAdapterOptions = RetryOption & {
  /** The client. The adapter calls `client.models.generateContent(params)` and nothing else. */
  client: GoogleClientLike;
  /** The model id, such as `gemini-3-pro`. */
  model: string;
  /** The agent's tools, or a factory that builds them per session. */
  tools?: SdkTools;
  /** The system instruction. System messages in the history are appended to it. */
  system?: string;
  /** `maxOutputTokens` of each call; unset leaves the model's default. */
  maxOutputTokens?: number;
  /** The most model calls one block may take. Default 8; a block's `budget.steps` lowers it. */
  maxSteps?: number;
  /** The tools that change the world. Their inputs are the payloads `endState` reads. Enables `endState`. */
  sideEffects?: readonly string[];
  /** True when the same input gives the same output. Default false. */
  deterministic?: boolean;
  /** The version the runner's cache key carries. Default the adapter's, with a hash of the model and system instruction. */
  version?: string;
};

type GoogleState = SdkState & { readonly kind: 'google'; tools: ReadonlyMap<string, SdkTool> };

export function googleAdapter(options: GoogleAdapterOptions): AgentAdapter {
  const id = 'google';
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

  async function generate(
    params: GoogleGenerateParams,
    block: number,
    policy: RetryPolicy,
  ): Promise<GoogleGenerateResponse> {
    const answer: unknown = await callModel(
      `generateContent (${options.model}) on block ${block}`,
      () => options.client.models.generateContent(params),
      policy,
      options,
    );
    if (!isPlainObject(answer)) {
      throw new AgentFailure(`generateContent (${options.model}) answered something that is not an object`);
    }
    return answer as GoogleGenerateResponse;
  }

  return {
    id,
    version:
      options.version ??
      `${GOOGLE_ADAPTER_VERSION}+${contentHash({ model: options.model, system: options.system ?? null })}`,
    capabilities: () => ({ ...capabilities }),

    async open(given) {
      // Validate and freeze before user-supplied setup receives the Given.
      copyHistory(given.prefix);
      const list = typeof options.tools === 'function' ? options.tools(given) : (options.tools ?? []);
      const state: GoogleState = {
        kind: 'google',
        closed: false,
        payloads: new Map(),
        tools: new Map(list.map((tool) => [tool.name, tool])),
      };
      return openSession(id, given, state);
    },

    async send(session: Session, turn: Turn) {
      const sharedHistory = copyHistory(session.history);
      const state = ownState<GoogleState>(session, id, 'google');
      const names = new WireNames(state.tools.keys(), GOOGLE_NAME, 128);
      const history = toGoogleContents(sharedHistory, names);
      // A prompt version from the registry replaces the configured system prompt.
      const system = [session.target.prompt?.text ?? options.system ?? '', ...history.system]
        .filter((part) => part !== '')
        .join('\n\n');
      const contents: GoogleContent[] = history.contents;
      const declarations = [...state.tools.values()].map((tool) => ({
        name: names.wire(tool.name),
        ...(tool.description === undefined ? {} : { description: tool.description }),
        parametersJsonSchema: tool.inputSchema ?? { type: 'object' },
      }));
      const config: NonNullable<GoogleGenerateParams['config']> = {
        ...(system === '' ? {} : { systemInstruction: system }),
        ...(declarations.length === 0 ? {} : { tools: [{ functionDeclarations: declarations }] }),
        ...(options.maxOutputTokens === undefined ? {} : { maxOutputTokens: options.maxOutputTokens }),
      };
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
      const usage = newUsage();
      let latencyMs = 0;
      for (let step = 1; ; step++) {
        const started = performance.now();
        const answer = await generate({ model: options.model, contents, config }, turn.index, policy);
        const callMs = Math.round(performance.now() - started);
        latencyMs += callMs;
        const meta = answer.usageMetadata;
        // Thinking tokens are billed as output.
        const output =
          meta?.candidatesTokenCount === undefined && meta?.thoughtsTokenCount === undefined
            ? undefined
            : (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0);
        const cost = addUsage(usage, meta?.promptTokenCount, output);
        const take = measureOnce({ latencyMs: callMs, ...(cost ? { cost } : {}) });

        const candidate = answer.candidates?.[0];
        if (candidate === undefined) {
          const blocked = answer.promptFeedback?.blockReason;
          throw new AgentFailure(
            `generateContent (${options.model}) answered no candidate on block ${turn.index}${blocked ? `: the prompt was blocked (${blocked})` : ''}`,
          );
        }
        finishReasons.push(candidate.finishReason ?? null);
        const parts: GooglePart[] = Array.isArray(candidate.content?.parts) ? candidate.content.parts : [];
        const asked: { id: string; wireId?: string; label: string; wireName: string; input: unknown }[] = [];
        for (const part of parts) {
          if (typeof part.text === 'string' && part.text !== '' && part.thought !== true) {
            segments.push({ type: 'text', text: part.text, ...take() });
          } else if (part.functionCall && typeof part.functionCall.name === 'string') {
            const call = part.functionCall;
            const label = names.label(call.name as string);
            const segmentId = call.id ?? `fc-${turn.index}-${step}-${asked.length + 1}`;
            const input = call.args ?? null;
            asked.push({
              id: segmentId,
              ...(call.id === undefined ? {} : { wireId: call.id }),
              label,
              wireName: call.name as string,
              input,
            });
            segments.push({ type: 'tool_call', id: segmentId, label, input, ...take() });
          }
        }
        if (asked.length === 0) break;
        if (step >= cap) {
          throw new AgentFailure(
            `the agent still asked for ${asked.map((call) => call.label).join(', ')} after ${cap} model calls on block ${turn.index}`,
          );
        }
        // The model's own content goes back unchanged, so a signed function call keeps its signature.
        contents.push({ role: candidate.content?.role ?? 'model', parts });
        const responses: GooglePart[] = [];
        for (const call of asked) {
          const { outcome, latencyMs: toolMs } = await answerTool(
            call.label,
            call.input,
            state.tools,
            context,
          );
          const response =
            outcome.error !== undefined ? { error: outcome.error } : { output: outcome.output ?? null };
          if (outcome.error !== undefined) {
            segments.push({
              type: 'tool_result',
              id: call.id,
              label: call.label,
              output: null,
              error: outcome.error,
              latencyMs: toolMs,
            });
          } else {
            segments.push({
              type: 'tool_result',
              id: call.id,
              label: call.label,
              output: outcome.output,
              latencyMs: toolMs,
            });
          }
          responses.push({
            functionResponse: {
              ...(call.wireId === undefined ? {} : { id: call.wireId }),
              name: call.wireName,
              response: argsOf(response),
            },
          });
        }
        contents.push({ role: 'user', parts: responses });
      }

      // The finish reason of each model call, in order: `MAX_TOKENS` on the last one means a cut reply.
      const observed = observedOf(segments, usage, latencyMs, `the ${options.model} agent`, {
        raw: { finishReasons },
        ...(history.normalizations.length > 0 ? { historyNormalizations: history.normalizations } : {}),
      });
      recordPayloads(state, turn.index, observed.toolCalls, sideEffects);
      return observed;
    },

    async endState(session, source) {
      const state = ownState<GoogleState>(session, id, 'google');
      if (options.sideEffects === undefined) {
        throw new Error('the google adapter names no sideEffects tools, so it records no payload');
      }
      return readPayloads(payloadLog(state), source, id);
    },

    async close(session) {
      const state = session.state as GoogleState | undefined;
      if (state?.kind !== 'google') return;
      state.closed = true;
      state.payloads.clear();
    },
  };
}
