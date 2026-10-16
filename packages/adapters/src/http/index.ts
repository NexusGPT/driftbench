import { randomUUID } from 'node:crypto';
import {
  type AdapterCapabilities,
  AdapterTransportError,
  type AgentAdapter,
  AgentFailure,
  contentHash,
  copyHistory,
  decideToolRule,
  deniesCall,
  isPlainObject,
  type Observed,
  retryableStatus,
  Segment,
  type Session,
  type ToolCall,
  type ToolRule,
  type Turn,
} from '@agent-nexus/driftbench-core';
import {
  excerpt,
  type FetchLike,
  type HttpReply,
  joinText,
  parseObserved,
  promptMessages,
  sendRequest,
  toolCallsOf,
} from '../shared';
import { type ChatMessage, isChatCompletion, readCompletion, toChatMessages } from './chat';

export type { FetchLike } from '../shared';
export type { ChatMessage, ChatToolCall } from './chat';

/**
 * The http adapter: an agent behind an HTTP endpoint that speaks JSON.
 *
 * Each block is one POST to `url` with the session id, the block index, the session history in the
 * OpenAI-compatible chat shape (the runner has already ended it with the block's user messages), the
 * stimulus, the world, the vars and the target. The endpoint answers with an Observed, or with an
 * OpenAI-compatible chat completion. A completion that asks for tools is answered from `world.tools` and
 * posted again, round after round, until a completion asks for none.
 *
 * Errors: no connection, a timeout, a 408, a 429 or a 5xx is an AdapterTransportError, which the runner retries
 * under the shared policy, honouring Retry-After; any other failing status or a body of neither shape is an
 * AgentFailure.
 */

export const HTTP_ADAPTER_VERSION = '0.1.1';

export type HttpAdapterOptions = {
  /** The endpoint that answers one block. */
  url: string;
  /** Headers sent with every request, such as an authorization header built from the environment. */
  headers?: Record<string, string>;
  /** Reads the end state: POST `{ session, source }`, answered by `{ state }`. Enables `endState`. */
  endStateUrl?: string;
  /** Told when a session closes: POST `{ session }`. */
  closeUrl?: string;
  /** What the endpoint honours beyond the conversation. Each defaults to false. */
  capabilities?: Partial<Pick<AdapterCapabilities, 'variants' | 'toolStubs' | 'deterministic'>>;
  /** The most milliseconds one request may take. Default 120000. */
  timeoutMs?: number;
  /** The most rounds of tool calls a chat completion may ask for in one block. Default 8. */
  maxToolRounds?: number;
  /** A tool policy applied to every tool a chat completion asks for, before the harness answers it. A denied call
   *  is answered with an error, and its stub is never read. Absent: every requested tool is answered from world.tools. */
  toolPolicy?: readonly ToolRule[];
  /** The fetch to use. Default the global fetch. */
  fetch?: FetchLike;
};

/** The JSON body of one block's request. */
export type HttpTurnRequest = {
  session: string;
  turn: number;
  /** `target.agent`, for endpoints that pick a model or an agent by name. */
  model?: string;
  messages: ChatMessage[];
  stimulus: Turn['stimulus'];
  world: Turn['given']['world'];
  vars: Turn['given']['vars'];
  target: Session['target'];
};

type HttpState = { readonly kind: 'http'; closed: boolean };

export function httpAdapter(options: HttpAdapterOptions): AgentAdapter {
  const id = 'http';
  const fetchFn: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxToolRounds = options.maxToolRounds ?? 8;
  const capabilities: AdapterCapabilities = {
    variants: options.capabilities?.variants ?? false,
    seedPrefix: true,
    toolStubs: options.capabilities?.toolStubs ?? false,
    trace: false,
    sandbox: false,
    endState: options.endStateUrl !== undefined,
    deterministic: options.capabilities?.deterministic ?? false,
  };

  async function post(url: string, body: unknown): Promise<HttpReply> {
    const label = `POST ${url}`;
    const reply = await sendRequest(
      fetchFn,
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...options.headers },
        body: JSON.stringify(body),
      },
      timeoutMs,
      label,
    );
    if (retryableStatus(reply.status)) {
      throw new AdapterTransportError(`${label} answered ${reply.status}: ${excerpt(reply.text)}`, {
        status: reply.status,
        ...(reply.retryAfterMs === undefined ? {} : { retryAfterMs: reply.retryAfterMs }),
      });
    }
    return reply;
  }

  function judge(reply: HttpReply, url: string): Record<string, unknown> {
    if (reply.status < 200 || reply.status >= 300) {
      throw new AgentFailure(`POST ${url} answered ${reply.status}: ${excerpt(reply.text)}`);
    }
    if (!isPlainObject(reply.json)) {
      throw new AgentFailure(`POST ${url} answered ${reply.status} with a body that is not a JSON object`);
    }
    return reply.json;
  }

  function own(session: Session): HttpState {
    const state = session.state as HttpState | undefined;
    if (session.adapter !== id || state?.kind !== 'http') {
      throw new Error(`session ${session.id} was not opened by the http adapter`);
    }
    if (state.closed) throw new Error(`session ${session.id} is closed`);
    return state;
  }

  /** An Observed the endpoint returned; `text`, `toolCalls`, `cost` and `latencyMs` may be left out. */
  function fromObserved(body: Record<string, unknown>, latencyMs: number): Observed {
    const segments = Segment.array().safeParse(body.segments);
    if (!segments.success) return parseObserved(body, `POST ${options.url}`);
    return parseObserved(
      {
        ...body,
        text: body.text ?? joinText(segments.data),
        toolCalls: body.toolCalls ?? toolCallsOf(segments.data),
        cost: body.cost ?? {},
        latencyMs: body.latencyMs ?? latencyMs,
      },
      `POST ${options.url}`,
    );
  }

  /** Runs a chat completion endpoint's tool rounds from `world.tools`, and maps every round to segments. */
  async function fromCompletions(first: HttpReply, request: HttpTurnRequest, turn: Turn): Promise<Observed> {
    const segments: Segment[] = [];
    const toolCalls: ToolCall[] = [];
    const usage = { inputTokens: 0, outputTokens: 0, seen: false };
    const messages = [...request.messages];
    let latencyMs = 0;
    let finishReason: string | undefined;
    let reply = first;
    for (let round = 0; ; round++) {
      const completion = readCompletion(judge(reply, options.url));
      if (!completion) {
        throw new AgentFailure(`POST ${options.url} answered a chat completion with no choices[0].message`);
      }
      latencyMs += reply.latencyMs;
      finishReason = completion.finishReason;
      if (completion.usage) {
        usage.seen = true;
        usage.inputTokens += completion.usage.inputTokens ?? 0;
        usage.outputTokens += completion.usage.outputTokens ?? 0;
      }
      // The round's latency and tokens go on its first segment, so the segments add up to the block.
      let measure: Pick<Observed['segments'][number], 'cost' | 'latencyMs'> | undefined = {
        latencyMs: reply.latencyMs,
        ...(completion.usage ? { cost: { ...completion.usage } } : {}),
      };
      const take = () => {
        const taken = measure ?? {};
        measure = undefined;
        return taken;
      };
      const { content, toolCalls: asked } = completion.message;
      if (content !== '') segments.push({ type: 'text', text: content, ...take() });
      if (asked.length === 0) break;
      if (round >= maxToolRounds) {
        throw new AgentFailure(`POST ${options.url} still asked for tools after ${maxToolRounds} rounds`);
      }
      const calls = asked.map((call, index) => ({
        ...call,
        id: call.id ?? `call-${round + 1}-${index + 1}`,
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
        const rule = options.toolPolicy ? decideToolRule(options.toolPolicy, call.name) : undefined;
        if (deniesCall(rule)) {
          // Refused before the harness answers: the stub is never read, and the model gets the refusal as the result.
          const why =
            rule?.action === 'ask'
              ? `tool policy rule ${rule.pattern} asks, and no approver answers, so the call is denied`
              : `denied by tool policy rule ${rule?.pattern ?? ''}`;
          segments.push({
            type: 'tool_call',
            id: call.id,
            label: call.name,
            input: call.arguments,
            ...take(),
          });
          segments.push({ type: 'tool_result', id: call.id, label: call.name, output: null, error: why });
          toolCalls.push({ id: call.id, label: call.name, input: call.arguments, error: why });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: why }) });
          continue;
        }
        const stub = turn.given.world.tools?.[call.name];
        if (!stub || (stub.error === undefined && !('result' in stub))) {
          throw new AgentFailure(
            `POST ${options.url} asked driftbench to run ${call.name}, and world.tools has no result or error for it`,
          );
        }
        const latency = stub.latency_ms === undefined ? {} : { latencyMs: stub.latency_ms };
        segments.push({ type: 'tool_call', id: call.id, label: call.name, input: call.arguments, ...take() });
        if (stub.error !== undefined) {
          segments.push({
            type: 'tool_result',
            id: call.id,
            label: call.name,
            output: null,
            error: stub.error,
          });
          toolCalls.push({
            id: call.id,
            label: call.name,
            input: call.arguments,
            error: stub.error,
            ...latency,
          });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: stub.error }),
          });
        } else {
          const output = stub.result ?? null;
          segments.push({ type: 'tool_result', id: call.id, label: call.name, output, ...latency });
          toolCalls.push({ id: call.id, label: call.name, input: call.arguments, output, ...latency });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
        }
      }
      reply = await post(options.url, { ...request, messages });
      if (!isChatCompletion(judge(reply, options.url))) {
        throw new AgentFailure(
          `POST ${options.url} answered a tool round with something other than a completion`,
        );
      }
    }
    return parseObserved(
      {
        segments,
        text: joinText(segments),
        toolCalls,
        cost: usage.seen ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : {},
        latencyMs,
        ...(finishReason === undefined ? {} : { runtime: { finishReason } }),
      },
      `POST ${options.url}`,
    );
  }

  return {
    id,
    version: `${HTTP_ADAPTER_VERSION}+${contentHash(options.url)}`,
    capabilities: () => ({ ...capabilities }),

    async open(given) {
      const state: HttpState = { kind: 'http', closed: false };
      return {
        id: randomUUID(),
        adapter: id,
        target: given.target,
        given,
        history: copyHistory(given.prefix),
        state,
      };
    },

    async send(session, turn) {
      const history = copyHistory(session.history);
      own(session);
      const request: HttpTurnRequest = {
        session: session.id,
        turn: turn.index,
        ...(session.target.agent === undefined ? {} : { model: session.target.agent }),
        messages: toChatMessages(promptMessages(history, session.target)),
        stimulus: turn.stimulus,
        world: turn.given.world,
        vars: turn.given.vars,
        target: session.target,
      };
      const reply = await post(options.url, request);
      const body = judge(reply, options.url);
      if (Array.isArray(body.segments)) return fromObserved(body, reply.latencyMs);
      if (isChatCompletion(body)) return fromCompletions(reply, request, turn);
      throw new AgentFailure(
        `POST ${options.url} answered neither an Observed (segments) nor a chat completion (choices)`,
      );
    },

    async endState(session, source) {
      own(session);
      if (options.endStateUrl === undefined) throw new Error('the http adapter has no endStateUrl to read');
      const reply = await post(options.endStateUrl, { session: session.id, source });
      const state = reply.status === 404 ? undefined : (judge(reply, options.endStateUrl).state ?? undefined);
      if (source !== '*') return state;
      // Source * lists every payload; an endpoint that recorded nothing may answer 404 or no state.
      if (state === undefined) return [];
      if (!Array.isArray(state)) {
        throw new AgentFailure(
          `POST ${options.endStateUrl} answered a state that is not a list for source *`,
        );
      }
      return state;
    },

    async close(session) {
      const state = session.state as HttpState | undefined;
      if (state?.kind !== 'http' || state.closed) return;
      state.closed = true;
      if (options.closeUrl === undefined) return;
      judge(await post(options.closeUrl, { session: session.id }), options.closeUrl);
    },
  };
}
