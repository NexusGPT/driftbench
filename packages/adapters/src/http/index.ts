import { randomUUID } from 'node:crypto';
import {
  type AdapterCapabilities,
  AdapterTransportError,
  type AgentAdapter,
  AgentFailure,
  contentHash,
  isPlainObject,
  type Observed,
  Segment,
  type Session,
  type ToolCall,
  type Turn,
} from '@driftbench/core';
import { joinText, parseObserved, stimulusMessages, toolCallsOf } from '../function/shared';
import { type ChatMessage, isChatCompletion, readCompletion, toChatMessages } from './chat';
import { excerpt, type FetchLike, type HttpReply, sendRequest } from './transport';

export type { ChatMessage, ChatToolCall } from './chat';
export type { FetchLike } from './transport';

/**
 * The http adapter: an agent behind an HTTP endpoint that speaks JSON.
 *
 * Each block is one POST to `url` with the session id, the block index, the conversation so far plus the
 * block's user messages (in the OpenAI-compatible chat shape), the stimulus, the world, the vars and the
 * target. The endpoint answers with an Observed, or with an OpenAI-compatible chat completion. A completion
 * that asks for tools is answered from `world.tools` and posted again, round after round, until a
 * completion asks for none.
 *
 * Errors: no connection, a timeout, 408 or 429 is an AdapterTransportError, which the runner may retry; any
 * other failing status (5xx included) or a body of neither shape is an AgentFailure.
 */

export const HTTP_ADAPTER_VERSION = '0.1.0';

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
    if (reply.status === 408 || reply.status === 429) {
      throw new AdapterTransportError(`${label} answered ${reply.status}: ${excerpt(reply.text)}`);
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
    let reply = first;
    for (let round = 0; ; round++) {
      const completion = readCompletion(judge(reply, options.url));
      if (!completion) {
        throw new AgentFailure(`POST ${options.url} answered a chat completion with no choices[0].message`);
      }
      latencyMs += reply.latencyMs;
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
        history: structuredClone(given.prefix),
        state,
      };
    },

    async send(session, turn) {
      own(session);
      const request: HttpTurnRequest = {
        session: session.id,
        turn: turn.index,
        ...(session.target.agent === undefined ? {} : { model: session.target.agent }),
        messages: toChatMessages([...session.history, ...stimulusMessages(turn.stimulus)]),
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
      if (reply.status === 404) return undefined;
      const body = judge(reply, options.endStateUrl);
      return body.state ?? undefined;
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
