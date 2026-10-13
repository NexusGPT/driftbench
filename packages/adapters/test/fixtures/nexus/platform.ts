import { readFileSync } from 'node:fs';
import type { Message } from '@agent-nexus/driftbench-core';
import { type AcmeStore, createAcmeAgent, createStore } from '../../../../../examples/acme/src/index';
import type { FetchLike } from '../../../src/http/index';

/**
 * A fake Nexus public API v1, served through a `fetch` function: no network. It plays the routes the nexus
 * adapter calls, answers in the shapes of the fixture files next to it (each answer starts from a fixture and
 * replaces its values), and runs the Acme agent behind the golden conversations.
 *
 * - generate replays the conversation's turns into the Acme agent and answers like the platform: the tool
 *   calls with their outputs and the final text only. It opens a new emulator session with its own chat id
 *   and writes one trace for that chat: one generation per tool call, then one for the reply.
 * - A trace reads IN_PROGRESS for its first `traceLag` list reads, then COMPLETED.
 * - A successful call of a tool named in `stubs` records an execution of that stub workflow, with the
 *   call's input as `triggerData`.
 */

const HERE = new URL('.', import.meta.url);
const PREFIX = '/api/public/v1';

export function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(name, HERE), 'utf8')) as Record<string, unknown>;
}

function template(name: string, at?: number): Record<string, unknown> {
  const data = fixture(name).data;
  const value = at === undefined ? data : (data as unknown[])[at];
  return structuredClone(value) as Record<string, unknown>;
}

export type FakeNexusOptions = {
  apiKey: string;
  /** Tool label to stub workflow id. */
  stubs?: Record<string, string>;
  /** List reads that still see a trace IN_PROGRESS. Default 1. */
  traceLag?: number;
  /** The most generations a trace read lists; the rest are paged through the generation list. Default 100. */
  traceWindow?: number;
};

type CandidateCall = { name: string; input: unknown; output: unknown };
type GoldenTurn = { role: 'user' | 'agent'; content: string; toolCalls?: CandidateCall[] };
type Conversation = {
  id: string;
  agentId: string;
  deploymentId: string;
  variant?: string;
  turns: GoldenTurn[];
  pending?: { content: string; toolCalls: CandidateCall[] };
  store: AcmeStore;
};
type Trace = { row: Record<string, unknown>; generations: Record<string, unknown>[]; reads: number };

export type RecordedRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  apiKey: string | null;
  /** What the fake answered, when it answered. */
  answer?: { status: number; body: unknown };
};

export type FakeNexus = {
  readonly fetch: FetchLike;
  readonly requests: RecordedRequest[];
  readonly conversations: Map<string, Conversation>;
  readonly deleted: Set<string>;
  readonly executions: Record<string, unknown>[];
  /** The next request whose path matches fails: with this status, or with a dropped connection. */
  failNext(pattern: RegExp, failure: number | 'network'): void;
};

export function createFakeNexus(options: FakeNexusOptions): FakeNexus {
  const stubs = options.stubs ?? {};
  const traceLag = options.traceLag ?? 1;
  const traceWindow = options.traceWindow ?? 100;
  const requests: RecordedRequest[] = [];
  const conversations = new Map<string, Conversation>();
  const deleted = new Set<string>();
  const sessions = new Map<string, Record<string, unknown>>();
  const traces: Trace[] = [];
  const generations = new Map<string, Record<string, unknown>>();
  const executions: Record<string, unknown>[] = [];
  const failures: { pattern: RegExp; failure: number | 'network' }[] = [];
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

  async function generate(conversation: Conversation) {
    const messages: Message[] = conversation.turns.map((turn) =>
      turn.role === 'user'
        ? { role: 'user', content: turn.content }
        : {
            role: 'assistant',
            content: turn.content,
            tool_calls: (turn.toolCalls ?? []).map((call) => ({
              label: call.name,
              input: call.input as never,
              output: call.output as never,
            })),
          },
    );
    const observed = await createAcmeAgent(conversation.store).respond(messages);
    const toolCalls: CandidateCall[] = observed.toolCalls.map((call) => ({
      name: call.label,
      input: call.input,
      output: call.error === undefined ? call.output : { error: call.error },
    }));
    const finalText = [...observed.segments].reverse().find((segment) => segment.type === 'text');
    const content = finalText?.type === 'text' ? finalText.text : '';
    conversation.pending = { content, toolCalls };

    const sessionId = nextId('eeeeeeee');
    const chatId = nextId('cafecafe');
    const now = new Date();
    const session = template('emulator-session.json');
    Object.assign(session, {
      id: sessionId,
      deploymentId: conversation.deploymentId,
      chatId,
      createdAt: now.toISOString(),
      messages: [],
    });
    sessions.set(sessionId, session);
    writeTrace(conversation, chatId, messages, toolCalls, content, now.getTime());

    for (const call of observed.toolCalls) {
      const workflowId = stubs[call.label];
      if (workflowId === undefined || call.error !== undefined) continue;
      const execution = template('workflow-execution.json');
      Object.assign(execution, {
        id: nextId('e7000000'),
        workflowId,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        triggerData: structuredClone(call.input),
      });
      executions.push(execution);
    }
    return {
      conversationId: conversation.id,
      sessionId,
      candidate: { content, toolCalls, latencyMs: 1200, tokensUsed: { input: 0, output: 0, total: 0 } },
    };
  }

  /** One generation per tool call, then the reply; earlier turns appear as plain text, as on the platform. */
  function writeTrace(
    conversation: Conversation,
    chatId: string,
    history: Message[],
    calls: CandidateCall[],
    reply: string,
    start: number,
  ) {
    const traceId = nextId('7ace0000');
    const running: unknown[] = history.map((message) => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: [{ text: message.content, type: 'text' }],
    }));
    const written: Record<string, unknown>[] = [];
    const steps = [...calls.map((call) => ({ call })), { call: undefined }];
    steps.forEach(({ call }, index) => {
      const generation = template('tracing-generation-1.json');
      const startedAt = new Date(start + index * 1000);
      const toolId = `toolu_fake_${String(counter + 1).padStart(4, '0')}`;
      Object.assign(generation, {
        id: nextId('9e000000'),
        traceId,
        startedAt: startedAt.toISOString(),
        completedAt: new Date(startedAt.getTime() + 800).toISOString(),
        durationMs: 800,
        costUsd: 0.001 * (index + 1),
        inputTokens: 1000 + index,
        outputTokens: 50 + index,
        messages: structuredClone(running),
        finishReason: call ? 'tool_use' : 'end_turn',
        response: call ? null : reply,
        responseJson: call
          ? {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: toolId,
                  type: 'function',
                  function: { name: call.name, arguments: JSON.stringify(call.input) },
                },
              ],
            }
          : { role: 'assistant', content: reply },
      });
      if (call) {
        running.push(
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: '', signature: 'fictional-signature-for-tests' },
              { id: toolId, name: call.name, type: 'tool_use', input: call.input },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                content: [{ text: JSON.stringify(call.output), type: 'text' }],
                tool_use_id: toolId,
              },
            ],
          },
        );
      }
      generations.set(String(generation.id), generation);
      written.push(generation);
    });
    const row = template('tracing-traces.json', 0);
    Object.assign(row, {
      id: traceId,
      agentId: conversation.agentId,
      conversationId: chatId,
      generationCount: written.length,
      startedAt: new Date(start).toISOString(),
      completedAt: new Date(start + written.length * 1000).toISOString(),
    });
    traces.push({ row, generations: written, reads: 0 });
  }

  function generationRow(generation: Record<string, unknown>): Record<string, unknown> {
    const { messages, response, responseJson, systemPrompt, tools, ...row } = generation;
    return row;
  }

  function traceRow(trace: Trace): Record<string, unknown> {
    return { ...trace.row, status: trace.reads <= traceLag ? 'IN_PROGRESS' : 'COMPLETED' };
  }

  type Route = (
    match: RegExpMatchArray,
    query: Record<string, string>,
    body: unknown,
  ) => Promise<Answer> | Answer;
  type Answer = { status: number; body: unknown };
  const ok = (data: unknown, meta?: Record<string, unknown>): Answer => ({
    status: 200,
    body: meta === undefined ? { success: true, data } : { success: true, data, meta },
  });
  const missing = (what: string): Answer => ({
    status: 404,
    body: { success: false, error: { code: 'NOT_FOUND', message: `${what} not found` } },
  });
  const page = (rows: unknown[], query: Record<string, string>, limit: number) => {
    const size = Number(query.limit ?? limit);
    const number = Number(query.page ?? 1);
    const slice = rows.slice((number - 1) * size, number * size);
    return ok(slice, {
      total: rows.length,
      page: number,
      limit: size,
      totalPages: Math.ceil(rows.length / size),
      hasMore: number * size < rows.length,
    });
  };

  const routes: [string, RegExp, Route][] = [
    [
      'POST',
      /^\/prompt-eval\/golden-conversations$/,
      (_match, _query, body) => {
        const input = body as Record<string, unknown>;
        if (typeof input.agentId !== 'string' || typeof input.deploymentId !== 'string') {
          return {
            status: 400,
            body: { success: false, error: { code: 'VALIDATION_ERROR', message: 'bad body' } },
          };
        }
        const id = nextId('cccccccc');
        conversations.set(id, {
          id,
          agentId: input.agentId,
          deploymentId: input.deploymentId,
          ...(typeof input.variant === 'string' ? { variant: input.variant } : {}),
          turns: [],
          store: createStore(),
        });
        const created = template('golden-conversation.create.json');
        Object.assign(created, {
          id,
          agentId: input.agentId,
          deploymentId: input.deploymentId,
          title: input.title,
          description: input.description ?? null,
        });
        return ok(created);
      },
    ],
    [
      'POST',
      /^\/prompt-eval\/golden-conversations\/([^/]+)\/turns\/user$/,
      (match, _query, body) => {
        const conversation = conversations.get(match[1] ?? '');
        if (!conversation) return missing('Golden conversation');
        const text = (body as Record<string, unknown>).text;
        conversation.turns.push({ role: 'user', content: String(text) });
        conversation.pending = undefined;
        const turn = template('golden-conversation.turn-user.json');
        Object.assign(turn, {
          conversationId: conversation.id,
          index: conversation.turns.length - 1,
          content: text,
        });
        return ok(turn);
      },
    ],
    [
      'POST',
      /^\/prompt-eval\/golden-conversations\/([^/]+)\/generate$/,
      async (match) => {
        const conversation = conversations.get(match[1] ?? '');
        if (!conversation) return missing('Golden conversation');
        return ok(await generate(conversation));
      },
    ],
    [
      'POST',
      /^\/prompt-eval\/golden-conversations\/([^/]+)\/accept$/,
      (match) => {
        const conversation = conversations.get(match[1] ?? '');
        if (!conversation) return missing('Golden conversation');
        const pending = conversation.pending;
        if (!pending) {
          return {
            status: 400,
            body: { success: false, error: { code: 'NO_CANDIDATE', message: 'generate first' } },
          };
        }
        conversation.turns.push({ role: 'agent', content: pending.content, toolCalls: pending.toolCalls });
        conversation.pending = undefined;
        const turn = template('golden-conversation.accept.json');
        Object.assign(turn, {
          conversationId: conversation.id,
          index: conversation.turns.length - 1,
          content: pending.content,
          toolCalls: pending.toolCalls,
        });
        return ok(turn);
      },
    ],
    [
      'DELETE',
      /^\/prompt-eval\/golden-conversations\/([^/]+)$/,
      (match) => {
        const id = match[1] ?? '';
        if (!conversations.delete(id)) return missing('Golden conversation');
        deleted.add(id);
        return ok({ deleted: true });
      },
    ],
    [
      'GET',
      /^\/emulator\/([^/]+)\/sessions\/([^/]+)$/,
      (match) => {
        const session = sessions.get(match[2] ?? '');
        if (!session || session.deploymentId !== match[1]) return missing('Session');
        return ok(session);
      },
    ],
    [
      'GET',
      /^\/tracing\/traces$/,
      (_match, query) => {
        const found = traces.filter((trace) => trace.row.conversationId === query.conversationId);
        for (const trace of found) trace.reads++;
        return page(found.map(traceRow), query, 20);
      },
    ],
    [
      'GET',
      /^\/tracing\/traces\/([^/]+)$/,
      (match) => {
        const trace = traces.find((entry) => entry.row.id === match[1]);
        if (!trace) return missing('Trace');
        const detail = { ...template('tracing-trace.json'), ...traceRow(trace) };
        detail.generations = trace.generations.slice(0, traceWindow).map(generationRow);
        return ok(detail);
      },
    ],
    [
      'GET',
      /^\/tracing\/generations$/,
      (_match, query) => {
        const trace = traces.find((entry) => entry.row.id === query.traceId);
        return page((trace?.generations ?? []).map(generationRow), query, 20);
      },
    ],
    [
      'GET',
      /^\/tracing\/generations\/([^/]+)$/,
      (match) => {
        const generation = generations.get(match[1] ?? '');
        return generation ? ok(generation) : missing('Generation');
      },
    ],
    [
      'GET',
      /^\/workflows\/executions$/,
      (_match, query) => {
        const since = query.startDate === undefined ? 0 : Date.parse(query.startDate);
        const rows = executions
          .filter((execution) => execution.workflowId === query.workflowId)
          .filter((execution) => Date.parse(String(execution.startedAt)) >= since)
          .reverse()
          .map(({ triggerType, triggerData, error, outputData, pollingToken, ...row }) => row);
        return page(rows, query, 20);
      },
    ],
    [
      'GET',
      /^\/workflows\/executions\/([^/]+)$/,
      (match) => {
        const execution = executions.find((entry) => entry.id === match[1]);
        return execution ? ok(execution) : missing('Execution');
      },
    ],
  ];

  const fakeFetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname;
    const query = Object.fromEntries(url.searchParams.entries());
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const recorded: RecordedRequest = { method, path, query, body, apiKey: headers.get('api-key') };
    requests.push(recorded);
    const answer = (status: number, answerBody: unknown) => {
      recorded.answer = { status, body: answerBody };
      return respond(status, answerBody);
    };

    const failing = failures.findIndex((entry) => entry.pattern.test(path));
    if (failing >= 0) {
      const failure = failures.splice(failing, 1)[0]?.failure ?? 500;
      if (failure === 'network') throw new TypeError('fetch failed');
      return answer(failure, {
        success: false,
        error: { code: `HTTP_${failure}`, message: 'injected failure' },
      });
    }
    if (headers.get('api-key') !== options.apiKey) {
      return answer(401, {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid or missing API key' },
      });
    }
    for (const [verb, pattern, route] of routes) {
      const match = path.match(pattern);
      if (verb === method && match) {
        const routed = await route(match, query, body);
        return answer(routed.status, routed.body);
      }
    }
    return answer(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` },
    });
  };

  return {
    fetch: fakeFetch,
    requests,
    conversations,
    deleted,
    executions,
    failNext(pattern, failure) {
      failures.push({ pattern, failure });
    },
  };
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
