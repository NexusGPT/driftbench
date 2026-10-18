import {
  AdapterTransportError,
  AgentFailure,
  collectRetries,
  type Message,
  type RetryPolicy,
  retryPolicy,
  type Session,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { isTransient, vendorError, WireNames } from '../src/anthropic/common';
import { type AnthropicCreateParams, anthropicAdapter } from '../src/anthropic/index';
import { ANTHROPIC_NAME, toAnthropicMessages } from '../src/anthropic/messages';
import {
  acmeGiven,
  adapterContract,
  COVERAGE_QUESTION,
  converse,
  expectWholeObserved,
  sendUser,
} from './contract';
import { ACME_SIDE_EFFECTS } from './fixtures/sdk/acme-model';
import { acmeTools } from './fixtures/sdk/acme-tools';
import {
  deadAnthropic,
  FakeAnthropicError,
  fakeAnthropic,
  recordedAnthropic,
} from './fixtures/sdk/anthropic';
import recorded from './fixtures/sdk/recorded/anthropic-coverage.json';

const MODEL = 'claude-fake-acme';
const SYSTEM = 'You are the Acme Telecom sales assistant.';

function acme() {
  return anthropicAdapter({
    client: fakeAnthropic(),
    model: MODEL,
    system: SYSTEM,
    tools: () => acmeTools().tools,
    sideEffects: ACME_SIDE_EFFECTS,
    deterministic: true,
  });
}

adapterContract('anthropic', acme, {
  brokenTransport: () => anthropicAdapter({ client: deadAnthropic(), model: MODEL, sleep: async () => {} }),
  released: (session: Session) => (session.state as { closed?: boolean }).closed === true,
});

const given = acmeGiven({ adapter: 'anthropic' });

/** A client that answers each call with the next scripted content, and records the requests. */
function scripted(...answers: { content: unknown[]; stop_reason: string; usage?: unknown }[]) {
  return recordedAnthropic(
    answers.map((answer, index) => ({ id: `msg_${index}`, type: 'message', role: 'assistant', ...answer })),
  );
}

const toolUse = (id: string, name: string, input: unknown = {}) => ({ type: 'tool_use', id, name, input });

describe('anthropic adapter', () => {
  it('validates and freezes messages before the tools factory receives the Given', async () => {
    let called = 0;
    const adapter = anthropicAdapter({
      client: fakeAnthropic(),
      model: MODEL,
      tools: (start) => {
        called++;
        const message = start.prefix[0];
        if (!message) throw new Error('missing prefix');
        expect(() => {
          message.content = 'setup-mutated';
        }).toThrow(TypeError);
        return [];
      },
    });
    const session = await adapter.open({ ...given, prefix: [{ role: 'user', content: 'before' }] });
    expect(session.history[0]?.content).toBe('before');
    await adapter.close(session);
    await expect(
      adapter.open({
        ...given,
        prefix: [
          {
            role: 'user',
            get content() {
              return 'before';
            },
          },
        ],
      }),
    ).rejects.toThrow(/content.*accessor/);
    expect(called).toBe(1);
  });

  it('replays a recorded exchange: the same requests the real SDK sent, and the whole turn', async () => {
    const client = recordedAnthropic(recorded.exchanges.map((exchange) => exchange.response));
    const adapter = anthropicAdapter({
      client,
      model: MODEL,
      system: SYSTEM,
      tools: () => acmeTools().tools,
    });
    const session = await adapter.open(given);
    const observed = await sendUser(adapter, session, COVERAGE_QUESTION, 0);
    expect(client.requests).toEqual(recorded.exchanges.map((exchange) => exchange.request));
    expectWholeObserved(observed);
    expect(observed.toolCalls.map((call) => call.label)).toEqual(['coverage.check', 'catalog.search']);
    expect(observed.toolCalls[0]?.input).toEqual({ address: '3 Orchard Way, Acmeville' });
    const usage = recorded.exchanges.map((exchange) => exchange.response.usage);
    expect(observed.cost).toEqual({
      inputTokens: usage.reduce((sum, entry) => sum + entry.input_tokens, 0),
      outputTokens: usage.reduce((sum, entry) => sum + entry.output_tokens, 0),
    });
    expect(observed.segments[0]?.cost).toEqual({
      inputTokens: usage[0]?.input_tokens,
      outputTokens: usage[0]?.output_tokens,
    });
    expect(observed.raw).toEqual({ stopReasons: ['tool_use', 'tool_use', 'end_turn'] });
  });

  it('sends tool names the API accepts and reads them back as the spec labels', async () => {
    const client = fakeAnthropic();
    const passed: unknown[] = [];
    const create = client.messages.create.bind(client.messages);
    client.messages.create = (body, options) => {
      passed.push(options);
      return create(body, options);
    };
    const adapter = anthropicAdapter({ client, model: MODEL, tools: () => acmeTools().tools });
    await sendUser(adapter, await adapter.open(given), COVERAGE_QUESTION, 0);
    expect(passed[0], "the SDK's own retries are off: the shared policy owns them").toEqual({
      maxRetries: 0,
    });
    expect(client.requests[0]?.tools?.map((tool) => tool.name)).toEqual([
      'catalog_search',
      'coverage_check',
      'port_check',
      'order_create',
      'notify_sales',
    ]);
    const names = new WireNames(['a.b', 'a_b', 'x'.repeat(80)], ANTHROPIC_NAME);
    expect([names.wire('a.b'), names.wire('a_b'), names.wire('x'.repeat(80)).length]).toEqual([
      'a_b',
      'a_b_2',
      64,
    ]);
    expect([names.label('a_b'), names.label('a_b_2'), names.label('invented')]).toEqual([
      'a.b',
      'a_b',
      'invented',
    ]);
  });

  it('encodes the history: system text apart, tool calls as tool_use then tool_result, roles alternating', () => {
    const history: Message[] = [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Coverage at 9 Elm Street?' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            label: 'coverage.check',
            input: { address: '9 Elm Street' },
            error: 'coverage service unavailable',
          },
          {
            id: 'call 2',
            label: 'coverage.check',
            input: { address: '9 Elm Street' },
            output: { found: false },
          },
        ],
      },
      { role: 'user', content: 'Try again?' },
    ];
    const { messages, system } = toAnthropicMessages(
      history,
      new WireNames(['coverage.check'], ANTHROPIC_NAME),
    );
    expect(system).toEqual(['Be brief.']);
    expect(messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Coverage at 9 Elm Street?' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_h1', name: 'coverage_check', input: { address: '9 Elm Street' } },
          { type: 'tool_use', id: 'call_2', name: 'coverage_check', input: { address: '9 Elm Street' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_h1',
            content: 'coverage service unavailable',
            is_error: true,
          },
          { type: 'tool_result', tool_use_id: 'call_2', content: '{"found":false}' },
          { type: 'text', text: 'Try again?' },
        ],
      },
    ]);
  });

  it('keeps text written next to a tool call, in order, and sends the answer back as it came', async () => {
    const client = scripted(
      {
        content: [
          { type: 'text', text: 'Let me check that address.' },
          toolUse('toolu_1', 'coverage_check', { address: '3 Orchard Way' }),
        ],
        stop_reason: 'tool_use',
      },
      {
        content: [
          { type: 'thinking', thinking: 'fine', signature: 'sig' },
          { type: 'text', text: 'Fiber is there.' },
        ],
        stop_reason: 'end_turn',
      },
    );
    const adapter = anthropicAdapter({
      client,
      model: MODEL,
      tools: () => acmeTools().tools,
      system: SYSTEM,
    });
    const session = await adapter.open({
      ...given,
      prefix: [{ role: 'system', content: 'Answer in English.' }],
    });
    const observed = await sendUser(adapter, session, COVERAGE_QUESTION, 0);
    expectWholeObserved(observed);
    expect(observed.segments.map((segment) => segment.type)).toEqual([
      'text',
      'tool_call',
      'tool_result',
      'text',
    ]);
    expect(observed.text).toBe('Let me check that address.\nFiber is there.');
    expect(client.requests[0]?.system).toBe(`${SYSTEM}\n\nAnswer in English.`);
    const second = client.requests[1] as AnthropicCreateParams;
    expect(second.messages[1], 'the answer goes back as it came').toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check that address.' },
        toolUse('toolu_1', 'coverage_check', { address: '3 Orchard Way' }),
      ],
    });
    expect(second.messages[1]?.content[0]).toEqual({ type: 'text', text: 'Let me check that address.' });
    expect(second.messages[2]?.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' });
  });

  it('answers a call from world.tools before the tool runs, and keeps the forced latency', async () => {
    let ran = 0;
    const client = scripted(
      { content: [toolUse('toolu_1', 'coverage_check', { address: 'x' })], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' },
    );
    const adapter = anthropicAdapter({
      client,
      model: MODEL,
      tools: [{ name: 'coverage.check', run: () => ++ran }],
    });
    const world = { tools: { 'coverage.check': { result: { found: true }, latency_ms: 120 } } };
    const start = acmeGiven({ adapter: 'anthropic' }, world);
    const observed = await sendUser(adapter, await adapter.open(start), 'hi', 0, start);
    expect(ran).toBe(0);
    expect(observed.toolCalls).toEqual([
      {
        id: 'toolu_1',
        label: 'coverage.check',
        input: { address: 'x' },
        output: { found: true },
        latencyMs: 120,
      },
    ]);
    expect(client.requests[1]?.messages[2]?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"found":true}' },
    ]);
  });

  it('turns a throw in a tool into its error, and fails the block when nothing answers a call', async () => {
    const client = scripted(
      { content: [toolUse('toolu_1', 'coverage_check')], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Sorry.' }], stop_reason: 'end_turn' },
    );
    const throwing = anthropicAdapter({
      client,
      model: MODEL,
      tools: [
        {
          name: 'coverage.check',
          run: () => {
            throw new Error('address unknown');
          },
        },
      ],
    });
    const observed = await sendUser(throwing, await throwing.open(given), 'hi', 0);
    expect(observed.toolCalls[0]?.error).toBe('address unknown');
    expect(client.requests[1]?.messages[2]?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'address unknown', is_error: true },
    ]);

    const unanswered = anthropicAdapter({
      client: scripted({ content: [toolUse('toolu_1', 'port_check')], stop_reason: 'tool_use' }),
      model: MODEL,
    });
    await expect(sendUser(unanswered, await unanswered.open(given), 'hi', 0)).rejects.toThrow(
      /called port_check, and neither world.tools nor a tool implementation answers it/,
    );
  });

  it('stops at the step cap, lowered by the block budget', async () => {
    const loop = () => ({
      messages: {
        calls: 0,
        async create() {
          this.calls++;
          return { content: [toolUse(`toolu_${this.calls}`, 'coverage_check')], stop_reason: 'tool_use' };
        },
      },
    });
    const tools = [{ name: 'coverage.check', run: () => ({ found: true }) }];
    const capped = loop();
    const adapter = anthropicAdapter({ client: capped, model: MODEL, tools, maxSteps: 3 });
    await expect(sendUser(adapter, await adapter.open(given), 'hi', 0)).rejects.toBeInstanceOf(AgentFailure);
    expect(capped.messages.calls).toBe(3);

    const budgeted = loop();
    const second = anthropicAdapter({ client: budgeted, model: MODEL, tools, maxSteps: 3 });
    const session = await second.open(given);
    session.history.push({ role: 'user', content: 'hi' });
    await expect(
      second.send(session, { index: 0, stimulus: { user: 'hi' }, given, budget: { steps: 2 } }),
    ).rejects.toThrow(/after 2 model calls/);
    expect(budgeted.messages.calls).toBe(2);
  });

  it('resumes after a pause_turn with the paused content', async () => {
    const client = scripted(
      {
        content: [
          { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'acme' } },
        ],
        stop_reason: 'pause_turn',
      },
      { content: [{ type: 'text', text: 'Found it.' }], stop_reason: 'end_turn' },
    );
    const adapter = anthropicAdapter({ client, model: MODEL });
    const observed = await sendUser(adapter, await adapter.open(given), 'hi', 0);
    expect(observed.text).toBe('Found it.');
    expect(client.requests[1]?.messages.at(-1)).toEqual({
      role: 'assistant',
      content: [{ type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'acme' } }],
    });
  });

  it('tells a transport failure from the agent failing, by status, name and cause', async () => {
    const failing = (error: unknown) =>
      anthropicAdapter({
        client: { messages: { create: async () => Promise.reject(error) } },
        model: MODEL,
        sleep: async () => {},
      });
    const sent = async (error: unknown) => {
      const adapter = failing(error);
      return sendUser(adapter, await adapter.open(given), 'hi', 0).catch((caught: unknown) => caught);
    };
    for (const status of [429, 500, 529]) {
      const failure = await sent(new FakeAnthropicError(status, `status ${status}`));
      expect(failure, `status ${status}`).toBeInstanceOf(AdapterTransportError);
      expect(failure, 'retried in full: the runner does not retry it again').toMatchObject({
        exhausted: true,
        attempts: 4,
      });
    }
    expect(await sent(new FakeAnthropicError(408, 'status 408')), 'status 408').toBeInstanceOf(
      AdapterTransportError,
    );
    for (const status of [400, 401, 403, 404, 409]) {
      expect(
        await sent(new FakeAnthropicError(status, `status ${status}`)),
        `status ${status}`,
      ).toBeInstanceOf(AgentFailure);
    }
    expect(
      await sent(new FakeAnthropicError(undefined, 'Request timed out.', 'APIConnectionTimeoutError')),
    ).toBeInstanceOf(AdapterTransportError);
    expect(await sent(new Error('the model id is not known'))).toBeInstanceOf(AgentFailure);
    expect(await sent(Object.assign(new Error('wrapped'), { cause: { code: 'ECONNRESET' } }))).toBeInstanceOf(
      AdapterTransportError,
    );
    const shapeless = anthropicAdapter({
      client: { messages: { create: async () => ({ stop_reason: 'end_turn' }) as never } },
      model: MODEL,
    });
    await expect(sendUser(shapeless, await shapeless.open(given), 'hi', 0)).rejects.toThrow(
      /without a content list/,
    );
    expect(isTransient('a string')).toBe(false);
    expect(vendorError(new AgentFailure('kept'), 'x').message).toBe('kept');
  });

  it('retries a model call that fails with 429 then 529, honours Retry-After, and records both retries', async () => {
    let calls = 0;
    const waits: number[] = [];
    const inner = fakeAnthropic();
    const client = {
      messages: {
        async create(body: AnthropicCreateParams) {
          calls += 1;
          if (calls === 1) {
            throw Object.assign(new FakeAnthropicError(429, 'rate_limit_error'), {
              headers: new Headers({ 'retry-after': '2' }),
            });
          }
          if (calls === 2) throw new FakeAnthropicError(529, 'overloaded_error', 'InternalServerError');
          return inner.messages.create(body);
        },
      },
    };
    const adapter = anthropicAdapter({
      client,
      model: MODEL,
      tools: () => acmeTools().tools,
      retry: { jitter: false, baseDelayMs: 100 },
      sleep: async (ms) => void waits.push(ms),
    });
    const session = await adapter.open(given);
    session.history.push({ role: 'user', content: COVERAGE_QUESTION });
    const { value: observed, retries } = await collectRetries(() =>
      adapter.send(session, { index: 0, stimulus: { user: COVERAGE_QUESTION }, given }),
    );
    expectWholeObserved(observed);
    expect(observed.toolCalls.map((call) => call.label)).toEqual(['coverage.check', 'catalog.search']);
    expect(calls, 'two failures, then the three calls of the turn').toBe(5);
    expect(waits, 'Retry-After 2 s, then the doubled backoff').toEqual([2_000, 200]);
    expect(retries.map(({ call, attempt, status, delayMs }) => ({ call, attempt, status, delayMs }))).toEqual(
      [
        { call: `messages.create (${MODEL}) on block 0`, attempt: 1, status: 429, delayMs: 2_000 },
        { call: `messages.create (${MODEL}) on block 0`, attempt: 2, status: 529, delayMs: 200 },
      ],
    );
  });

  it('takes its retry policy from the turn, then the spec target, then its own settings', async () => {
    const attempts = async (turnRetry: RetryPolicy | undefined, target: Record<string, unknown> = {}) => {
      let calls = 0;
      const adapter = anthropicAdapter({
        client: {
          messages: {
            create: async () => {
              calls += 1;
              throw new FakeAnthropicError(503, 'down');
            },
          },
        },
        model: MODEL,
        retry: { maxAttempts: 5 },
        sleep: async () => {},
      });
      const start = acmeGiven({ adapter: 'anthropic', ...target });
      const session = await adapter.open(start);
      session.history.push({ role: 'user', content: 'hi' });
      await adapter
        .send(session, {
          index: 0,
          stimulus: { user: 'hi' },
          given: start,
          ...(turnRetry ? { retry: turnRetry } : {}),
        })
        .catch(() => undefined);
      return calls;
    };
    expect(await attempts(undefined)).toBe(5);
    expect(await attempts(undefined, { retry: { max_attempts: 2 } })).toBe(2);
    expect(await attempts(retryPolicy({ maxAttempts: 3 }), { retry: { max_attempts: 2 } })).toBe(3);
  });

  it("records each block's payloads once, so a retried block replaces its own", async () => {
    const order = { type: 'upgrade', customer_id: 'cust-001', plan_id: 'mobile-l' };
    const client = scripted(
      { content: [toolUse('toolu_1', 'order_create', order)], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Placed.' }], stop_reason: 'end_turn' },
      { content: [toolUse('toolu_2', 'order_create', order)], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Placed.' }], stop_reason: 'end_turn' },
    );
    const adapter = anthropicAdapter({
      client,
      model: MODEL,
      tools: [{ name: 'order.create', run: () => ({ order_id: 'ord-1' }) }],
      sideEffects: ['order.create'],
    });
    const session = await adapter.open(given);
    await sendUser(adapter, session, 'Confirm', 3);
    await adapter.send(session, { index: 3, stimulus: { user: 'Confirm' }, given });
    expect(await adapter.endState?.(session, '*')).toEqual([{ tool: 'order.create', input: order }]);
    await expect(adapter.endState?.(session, 'store:orders')).rejects.toThrow(/tool:<label> or \*/);
  });

  it('declares endState only with sideEffects, and closes for good', async () => {
    const bare = anthropicAdapter({ client: fakeAnthropic(), model: MODEL });
    expect(bare.capabilities()).toEqual({
      variants: false,
      seedPrefix: true,
      toolStubs: true,
      trace: false,
      sandbox: false,
      endState: false,
      deterministic: false,
    });
    const session = await bare.open(given);
    await expect(bare.endState?.(session, '*')).rejects.toThrow(/names no sideEffects/);
    expect(bare.version).toMatch(/^0\.1\.1\+/);
    expect(anthropicAdapter({ client: fakeAnthropic(), model: 'other' }).version).not.toBe(bare.version);
    await bare.close(session);
    await bare.close(session);
    await expect(converse(bare, session, 'hi', 0)).rejects.toThrow(/is closed/);
  });
});
