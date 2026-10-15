import {
  AdapterTransportError,
  AgentFailure,
  type Message,
  retryDecision,
  type Session,
} from '@agent-nexus/driftbench-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNRECORDED_RESULT } from '../src/anthropic/common';
import { toChatMessages } from '../src/http/chat';
import { httpAdapter } from '../src/http/index';
import { acmeGiven, adapterContract, COVERAGE_QUESTION, converse, sendUser, userTurn } from './contract';
import { type AcmeHttpServer, deadUrl, fromChatMessages, startAcmeServer } from './fixtures/http/acme-server';

let server: AcmeHttpServer;
let dead: string;

beforeAll(async () => {
  server = await startAcmeServer();
  dead = await deadUrl();
});
afterAll(async () => {
  await server.stop();
});

const acme = () =>
  httpAdapter({
    url: server.url,
    endStateUrl: `${server.base}/end-state`,
    closeUrl: `${server.base}/close`,
    capabilities: { toolStubs: true, deterministic: true },
  });

adapterContract('http', acme, {
  target: { adapter: 'http', agent: 'acme-sales', variant: 'candidate' },
  brokenTransport: () => httpAdapter({ url: dead }),
  released: (session: Session) => server.closedSessions.has(session.id),
});

const target = { adapter: 'http', agent: 'acme-sales' };
const given = acmeGiven(target);
const lastRequest = () => server.requests.at(-1);

describe('http adapter', () => {
  it('posts the session, the block, the messages in the chat shape, the stimulus, the world, the vars and the target', async () => {
    const adapter = httpAdapter({
      url: server.url,
      headers: { authorization: 'Bearer test-token-not-real' },
    });
    const session = await adapter.open(given);
    await converse(adapter, session, COVERAGE_QUESTION, 0);
    await sendUser(adapter, session, 'Acme Air 5G, please.', 1);
    const request = lastRequest();
    expect(request?.headers.authorization).toBe('Bearer test-token-not-real');
    expect(request?.body).toMatchObject({
      session: session.id,
      turn: 1,
      model: 'acme-sales',
      stimulus: { user: 'Acme Air 5G, please.' },
      world: {},
      vars: { channel: 'chat' },
      target,
    });
    const messages = request?.body.messages as {
      role: string;
      tool_calls?: unknown[];
      tool_call_id?: string;
    }[];
    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'tool',
      'assistant',
      'user',
    ]);
    expect(messages[1]?.tool_calls).toHaveLength(2);
    expect(messages[2]?.tool_call_id).toBe('call-1');
  });

  it('encodes a recorded tool error as {"error": ...} and decodes back to the same messages', () => {
    const history: Message[] = [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'Coverage is down.',
        tool_calls: [
          { id: 'c1', label: 'coverage.check', input: { address: '3 Orchard Way' }, error: 'timeout' },
          { id: 'c2', label: 'catalog.search', input: { category: 'home' }, output: { plans: [] } },
        ],
      },
    ];
    const chat = toChatMessages(history);
    expect(chat[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"error":"timeout"}' });
    expect(fromChatMessages(chat)).toEqual(history);
    expect(toChatMessages([{ role: 'assistant', content: '', tool_calls: [{ label: 'x' }] }])).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-h1', type: 'function', function: { name: 'x', arguments: '{}' } }],
      },
      // A call with no recorded result says so; it is never sent as null.
      { role: 'tool', tool_call_id: 'call-h1', content: JSON.stringify(UNRECORDED_RESULT) },
    ]);
  });

  it('fills what an endpoint leaves out of an Observed: text, toolCalls, cost and latency', async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          segments: [
            { type: 'tool_call', id: 't1', label: 'coverage.check', input: { address: 'x' } },
            { type: 'tool_result', id: 't1', label: 'coverage.check', output: { found: false } },
            { type: 'text', text: 'first' },
            { type: 'text', text: 'second' },
          ],
        }),
        { status: 200 },
      );
    const adapter = httpAdapter({ url: 'http://agent.test/turn', fetch: fetchFn });
    const observed = await adapter.send(await adapter.open(given), userTurn(0, 'hi', given));
    expect(observed.text).toBe('first\nsecond');
    expect(observed.toolCalls).toEqual([
      { id: 't1', label: 'coverage.check', input: { address: 'x' }, output: { found: false } },
    ]);
    expect(observed.cost).toEqual({});
    expect(observed.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports the finish reason of the last chat completion on the observed runtime', async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          choices: [
            { finish_reason: 'length', message: { role: 'assistant', content: 'The plan includes' } },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const adapter = httpAdapter({ url: 'http://agent.test/chat', fetch: fetchFn });
    const observed = await adapter.send(await adapter.open(given), userTurn(0, 'hi', given));
    expect(observed.runtime?.finishReason).toBe('length');
  });

  it('leaves the finish reason out when the endpoint reports none', async () => {
    const fetchFn = async () =>
      new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), {
        status: 200,
      });
    const adapter = httpAdapter({ url: 'http://agent.test/chat', fetch: fetchFn });
    const observed = await adapter.send(await adapter.open(given), userTurn(0, 'hi', given));
    expect(observed.runtime?.finishReason).toBeUndefined();
  });

  it('maps a chat completion with no tool call to one text segment, with its tokens', async () => {
    server.queueCompletion({
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello from a chat endpoint.' } }],
      usage: { prompt_tokens: 12, completion_tokens: 6 },
    });
    const adapter = httpAdapter({ url: `${server.base}/chat` });
    const observed = await adapter.send(await adapter.open(given), userTurn(0, 'hi', given));
    expect(observed.segments).toEqual([
      {
        type: 'text',
        text: 'Hello from a chat endpoint.',
        latencyMs: expect.any(Number),
        cost: { inputTokens: 12, outputTokens: 6 },
      },
    ]);
    expect(observed.cost).toEqual({ inputTokens: 12, outputTokens: 6 });
    expect(observed.toolCalls).toEqual([]);
  });

  it('runs the tools a chat completion asks for from world.tools, round after round', async () => {
    server.queueCompletion(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Let me check.',
              tool_calls: [
                {
                  id: 'a',
                  type: 'function',
                  function: { name: 'coverage.check', arguments: '{"address":"x"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      },
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'b', type: 'function', function: { name: 'catalog.search', arguments: '' } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          { message: { role: 'assistant', content: [{ type: 'text', text: 'No coverage there.' }] } },
        ],
      },
    );
    const world = {
      tools: {
        'coverage.check': { result: { found: false }, latency_ms: 40 },
        'catalog.search': { error: 'catalog offline' },
      },
    };
    const start = acmeGiven(target, world);
    const adapter = httpAdapter({ url: `${server.base}/chat`, capabilities: { toolStubs: true } });
    const observed = await sendUser(adapter, await adapter.open(start), 'hi', 0, start);
    expect(observed.segments.map((segment) => segment.type)).toEqual([
      'text',
      'tool_call',
      'tool_result',
      'tool_call',
      'tool_result',
      'text',
    ]);
    expect(observed.toolCalls).toEqual([
      { id: 'a', label: 'coverage.check', input: { address: 'x' }, output: { found: false }, latencyMs: 40 },
      { id: 'b', label: 'catalog.search', input: '', error: 'catalog offline' },
    ]);
    expect(observed.text).toBe('Let me check.\nNo coverage there.');
    expect(observed.cost).toEqual({ inputTokens: 10, outputTokens: 3 });
    const third = server.requests.at(-1)?.body.messages as { role: string; content: string | null }[];
    expect(third.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool']);
    expect(third[1]).toMatchObject({ role: 'assistant', content: 'Let me check.' });
    expect(third[2]).toEqual({ role: 'tool', tool_call_id: 'a', content: '{"found":false}' });
    expect(third[4]).toEqual({ role: 'tool', tool_call_id: 'b', content: '{"error":"catalog offline"}' });
  });

  it('refuses a tool the policy denies before answering it: the stub result never reaches the model', async () => {
    server.queueCompletion(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Let me check.',
              tool_calls: [
                {
                  id: 'a',
                  type: 'function',
                  function: { name: 'coverage.check', arguments: '{"address":"x"}' },
                },
                { id: 'b', type: 'function', function: { name: 'catalog.search', arguments: '' } },
              ],
            },
          },
        ],
      },
      { choices: [{ message: { role: 'assistant', content: 'Noted.' } }] },
    );
    const world = {
      tools: {
        'coverage.check': { result: { found: true } },
        'catalog.search': { result: { items: 2 } },
      },
    };
    const start = acmeGiven(target, world);
    const adapter = httpAdapter({
      url: `${server.base}/chat`,
      capabilities: { toolStubs: true },
      toolPolicy: [{ pattern: 'coverage.check', action: 'deny' }],
    });
    const observed = await sendUser(adapter, await adapter.open(start), 'hi', 0, start);
    expect(observed.toolCalls[0]).toEqual({
      id: 'a',
      label: 'coverage.check',
      input: { address: 'x' },
      error: 'denied by tool policy rule coverage.check',
    });
    expect(observed.toolCalls[1]).toMatchObject({ label: 'catalog.search', output: { items: 2 } });
    const second = server.requests.at(-1)?.body.messages as {
      role: string;
      content: string | null;
      tool_call_id?: string;
    }[];
    expect(second.find((message) => message.tool_call_id === 'a')).toEqual({
      role: 'tool',
      tool_call_id: 'a',
      content: '{"error":"denied by tool policy rule coverage.check"}',
    });
  });

  it('fails the block when a chat completion asks for a tool that world.tools does not answer', async () => {
    server.queueCompletion({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'a', type: 'function', function: { name: 'order.create', arguments: '{}' } }],
          },
        },
      ],
    });
    const adapter = httpAdapter({ url: `${server.base}/chat` });
    await expect(adapter.send(await adapter.open(given), userTurn(0, 'hi', given))).rejects.toThrow(
      /asked driftbench to run order\.create, and world\.tools has no result or error for it/,
    );
  });

  it('stops a chat endpoint that keeps asking for tools', async () => {
    const asking = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'a', type: 'function', function: { name: 'coverage.check', arguments: '{}' } },
            ],
          },
        },
      ],
    };
    server.queueCompletion(asking, asking, asking);
    const start = acmeGiven(target, { tools: { 'coverage.check': { result: {} } } });
    const adapter = httpAdapter({ url: `${server.base}/chat`, maxToolRounds: 2 });
    await expect(adapter.send(await adapter.open(start), userTurn(0, 'hi', start))).rejects.toThrow(
      /still asked for tools after 2 rounds/,
    );
  });

  it('retries a 408 like a 429 or a 5xx: a transport error, and a 408 then 200 succeeds after the retry', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      if (calls === 1) return new Response('{"error":"request timeout"}', { status: 408 });
      return new Response(JSON.stringify({ segments: [{ type: 'text', text: 'Back on line.' }] }), {
        status: 200,
      });
    };
    const adapter = httpAdapter({ url: 'http://agent.test/turn', fetch: fetchFn });
    const session = await adapter.open(given);
    const first = await adapter.send(session, userTurn(0, 'hi', given)).catch((caught: unknown) => caught);
    expect(first).toBeInstanceOf(AdapterTransportError);
    expect(first).toMatchObject({ status: 408 });
    expect(retryDecision(first).retry).toBe(true);
    const retried = await adapter.send(session, userTurn(0, 'hi', given));
    expect(retried.text).toBe('Back on line.');
    expect(calls).toBe(2);
  });

  it('answers a repeated 408 the way a repeated 503 is answered: a transport error the policy keeps retrying', async () => {
    const failing = (status: number) =>
      httpAdapter({
        url: 'http://agent.test/turn',
        fetch: async () => new Response('{"error":"down"}', { status }),
      });
    const timeout = await failing(408)
      .send(await failing(408).open(given), userTurn(0, 'hi', given))
      .catch((caught: unknown) => caught);
    const unavailable = await failing(503)
      .send(await failing(503).open(given), userTurn(0, 'hi', given))
      .catch((caught: unknown) => caught);
    expect(timeout).toBeInstanceOf(AdapterTransportError);
    expect(unavailable).toBeInstanceOf(AdapterTransportError);
    expect(retryDecision(timeout)).toMatchObject({ retry: true, status: 408 });
    expect(retryDecision(unavailable)).toMatchObject({ retry: true, status: 503 });
  });

  it('maps statuses by the shared retry rule: 408, 429 and 5xx are transport errors, other failures the agent', async () => {
    const send = (path: string, fetchFn?: typeof fetch) => {
      const adapter = httpAdapter({
        url: `${server.base}${path}`,
        headers: { authorization: 'Bearer secret-value' },
        ...(fetchFn ? { fetch: fetchFn } : {}),
      });
      return adapter.open(given).then((session) => adapter.send(session, userTurn(0, 'hi', given)));
    };
    for (const status of [400, 404, 409]) {
      const error = await send(`/status/${status}`).catch((caught: unknown) => caught);
      expect(error, `status ${status}`).toBeInstanceOf(AgentFailure);
      expect((error as Error).message).toContain(`answered ${status}`);
      expect((error as Error).message).not.toContain('secret-value');
    }
    for (const status of [408, 429, 500, 502, 503, 529]) {
      const error = await send(`/status/${status}`).catch((caught: unknown) => caught);
      expect(error, `status ${status}`).toBeInstanceOf(AdapterTransportError);
      expect(error).toMatchObject({ status });
      expect((error as Error).message).not.toContain('secret-value');
    }
    const limited = await send(
      '/turn',
      async () => new Response('{"error":"slow down"}', { status: 429, headers: { 'retry-after': '3' } }),
    ).catch((caught: unknown) => caught);
    expect(limited).toMatchObject({ status: 429, retryAfterMs: 3_000 });
    await expect(send('/not-json')).rejects.toThrow(/not a JSON object/);
  });

  it('fails the block on a body of neither shape, and on an Observed that does not validate', async () => {
    const answer = (body: unknown) =>
      httpAdapter({ url: 'http://agent.test/turn', fetch: async () => new Response(JSON.stringify(body)) });
    const run = async (body: unknown) => {
      const adapter = answer(body);
      return adapter.send(await adapter.open(given), userTurn(0, 'hi', given));
    };
    await expect(run({ reply: 'hello' })).rejects.toThrow(
      /neither an Observed \(segments\) nor a chat completion/,
    );
    await expect(run({ segments: [{ type: 'tool_call' }] })).rejects.toBeInstanceOf(AgentFailure);
    await expect(run({ choices: [] })).rejects.toThrow(/no choices\[0\]\.message/);
  });

  it('times out a silent endpoint as a transport error', async () => {
    const adapter = httpAdapter({ url: `${server.base}/silent`, timeoutMs: 100 });
    const error = await adapter
      .send(await adapter.open(given), userTurn(0, 'hi', given))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterTransportError);
    expect((error as Error).message).toContain('no answer within 100 ms');
  });

  it('reads no end state without an endStateUrl, and undefined when the endpoint has none', async () => {
    const bare = httpAdapter({ url: server.url });
    expect(bare.capabilities().endState).toBe(false);
    await expect(bare.endState?.(await bare.open(given), 'tool:order.create')).rejects.toThrow(
      /no endStateUrl/,
    );
    const adapter = acme();
    const session = await adapter.open(given);
    expect(await adapter.endState?.(session, 'tool:order.create')).toBeUndefined();
  });

  it('reads source * as a list: an empty one when the endpoint recorded nothing, a failure when it is not a list', async () => {
    const answering = (status: number, body: unknown) =>
      httpAdapter({
        url: 'http://agent.test/turn',
        endStateUrl: 'http://agent.test/end-state',
        fetch: async () => new Response(JSON.stringify(body), { status }),
      });
    const nothing = answering(404, { error: 'none' });
    expect(await nothing.endState?.(await nothing.open(given), '*')).toEqual([]);
    const empty = answering(200, {});
    expect(await empty.endState?.(await empty.open(given), '*')).toEqual([]);
    const wrong = answering(200, { state: { tool: 'order.create' } });
    await expect(wrong.endState?.(await wrong.open(given), '*')).rejects.toThrow(/not a list for source \*/);
  });

  it('carries the url in its version, so two endpoints never share a cache entry', () => {
    expect(httpAdapter({ url: 'http://a.test/turn' }).version).not.toBe(
      httpAdapter({ url: 'http://b.test/turn' }).version,
    );
    expect(httpAdapter({ url: 'http://a.test/turn' }).version).toBe(
      httpAdapter({ url: 'http://a.test/turn' }).version,
    );
  });
});
