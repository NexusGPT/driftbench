import {
  AdapterTransportError,
  AgentFailure,
  type Session,
  type TargetRef,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { type NexusAdapterOptions, nexusAdapter } from '../src/nexus/index';
import {
  cardOf,
  type Generation,
  observedFromCandidate,
  observedFromGenerations,
  readCandidate,
} from '../src/nexus/turn';
import {
  acmeGiven,
  adapterContract,
  COVERAGE_QUESTION,
  converse,
  expectWholeObserved,
  UPGRADE_CONVERSATION,
  UPGRADE_PAYLOAD,
  userTurn,
} from './contract';
import { createFakeNexus, type FakeNexus, fixture } from './fixtures/nexus/platform';

const KEY = 'test-key-not-real';
const env = { NEXUS_API_KEY: KEY, NEXUS_BASE_URL: 'https://nexus.test' };
const STUB_ORDER = 'f1000000-0000-4000-8000-000000000001';
const STUB_LEAD = 'f1000000-0000-4000-8000-000000000002';
const stubs = { 'order.create': STUB_ORDER, notify_sales: STUB_LEAD };
const target: TargetRef = {
  adapter: 'nexus',
  agent: 'aaaaaaaa-0000-4000-8000-000000000001',
  deployment: 'dddddddd-0000-4000-8000-000000000001',
  variant: 'candidate',
  options: { stubs },
};

const platform = createFakeNexus({ apiKey: KEY, stubs });
const on = (fake: FakeNexus, extra: NexusAdapterOptions = {}) =>
  nexusAdapter({ env, fetch: fake.fetch, pollIntervalMs: 0, traceWaitMs: 2_000, ...extra });

adapterContract('nexus', () => on(platform), {
  target,
  brokenTransport: () =>
    nexusAdapter({
      env,
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    }),
  released: (session: Session) => platform.deleted.has(session.id),
});

const generations = [1, 2, 3].map((n) => fixture(`tracing-generation-${n}.json`).data as Generation);
const generated = fixture('golden-conversation.generate.json').data as { candidate: unknown };
const candidate = readCandidate(generated.candidate, 'the fixture');
const LEAD = 'Let me check what reaches 3 Orchard Way.';
const COVERAGE_OUTPUT = {
  found: true,
  address_id: 'addr-102',
  address: '3 Orchard Way, Acmeville',
  fiber_mbps: 300,
  five_g: true,
};

describe('nexus turn readers, on the captured shapes', () => {
  it('reads the whole turn from tracing, the text sent before a tool call included', () => {
    const observed = observedFromGenerations(generations, candidate, { traceIds: ['t'] });
    expectWholeObserved(observed);
    expect(observed.segments.map((segment) => segment.type)).toEqual([
      'text',
      'tool_call',
      'tool_result',
      'tool_call',
      'tool_result',
      'text',
    ]);
    expect(observed.text).toBe(`${LEAD}\n${candidate.content}`);
    expect(observed.toolCalls).toEqual([
      {
        id: 'toolu_acme_coverage_0001',
        label: 'coverage.check',
        input: { address: '3 Orchard Way, Acmeville' },
        output: COVERAGE_OUTPUT,
        startedAt: '2026-01-15T10:00:03.100Z',
      },
      {
        id: 'toolu_acme_catalog_0002',
        label: 'catalog.search',
        input: { category: 'home', address_id: 'addr-102' },
        output: candidate.toolCalls[1]?.output,
        startedAt: '2026-01-15T10:00:05.300Z',
      },
    ]);
    expect(observed.raw).toEqual({ traceIds: ['t'] });
  });

  it('puts each generation cost, tokens and duration on its first segment, and adds them up for the block', () => {
    const observed = observedFromGenerations(generations, candidate, undefined);
    const [lead, coverageCall, coverageResult, catalogCall, catalogResult, reply] = observed.segments;
    expect(lead).toMatchObject({
      cost: { usd: 0.0112, inputTokens: 1610, outputTokens: 74 },
      latencyMs: 2100,
    });
    expect(coverageCall?.cost).toBeUndefined();
    expect(coverageResult?.cost).toBeUndefined();
    expect(catalogCall).toMatchObject({
      cost: { usd: 0.0131, inputTokens: 1720, outputTokens: 61 },
      latencyMs: 1900,
    });
    expect(catalogResult?.cost).toBeUndefined();
    expect(reply).toMatchObject({
      cost: { usd: 0.0178, inputTokens: 1820, outputTokens: 152 },
      latencyMs: 2650,
    });
    expect(observed.cost).toEqual({ usd: 0.0421, inputTokens: 5150, outputTokens: 287 });
    expect(observed.latencyMs, 'first start to last end, tool runs included').toBe(7250);
  });

  it('reads generations in start order, whatever order they arrive in', () => {
    const forward = observedFromGenerations(generations, candidate, undefined);
    const shuffled = observedFromGenerations(
      [generations[2], generations[0], generations[1]] as Generation[],
      candidate,
      undefined,
    );
    expect(shuffled.segments).toEqual(forward.segments);
  });

  it('keeps what generate returns in the send view: the tool calls with outputs and the final text only', () => {
    const observed = observedFromCandidate(candidate, 9_999, { sessionId: 's' });
    expectWholeObserved(observed);
    expect(observed.segments.map((segment) => segment.type)).toEqual([
      'tool_call',
      'tool_result',
      'tool_call',
      'tool_result',
      'text',
    ]);
    expect(observed.text, 'the platform keeps only the final text segment').toBe(candidate.content);
    expect(observed.text).not.toContain(LEAD);
    expect(observed.toolCalls[0]?.output).toEqual(COVERAGE_OUTPUT);
    expect(observed.cost).toEqual({ inputTokens: 5150, outputTokens: 287 });
    expect(observed.latencyMs).toBe(7480);
  });

  it('counts no tokens while the platform has not recorded them, and measures latency when generate gives none', () => {
    const fresh = readCandidate(
      { content: 'Hi.', toolCalls: [], tokensUsed: { input: 0, output: 0, total: 0 } },
      'x',
    );
    const observed = observedFromCandidate(fresh, 812, undefined);
    expect(observed.cost).toEqual({});
    expect(observed.latencyMs).toBe(812);
  });

  it('takes the output of a call the trace ended on from the candidate', () => {
    const observed = observedFromGenerations(generations.slice(0, 2), candidate, undefined);
    expect(observed.toolCalls.map((call) => call.label)).toEqual(['coverage.check', 'catalog.search']);
    expect(observed.toolCalls[1]?.output).toEqual(candidate.toolCalls[1]?.output);
    expect(observed.text).toBe(LEAD);
  });

  it('reads a tool_result marked is_error as the call error, and text that is not JSON as it is', () => {
    const call = (id: string, name: string) => ({
      role: 'assistant',
      content: '',
      tool_calls: [{ id, type: 'function', function: { name, arguments: '{"address":"nowhere"}' } }],
    });
    const result = (id: string, text: string, isError?: boolean) => ({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], is_error: isError },
      ],
    });
    const observed = observedFromGenerations(
      [
        { id: 'g1', startedAt: '2026-01-15T10:00:00Z', responseJson: call('a', 'coverage.check') },
        {
          id: 'g2',
          startedAt: '2026-01-15T10:00:01Z',
          messages: [result('a', 'service down', true)],
          responseJson: call('b', 'port.check'),
        },
        {
          id: 'g3',
          startedAt: '2026-01-15T10:00:02Z',
          messages: [result('b', 'plain words')],
          responseJson: { role: 'assistant', content: null },
          response: 'Sorry.',
        },
      ],
      undefined,
      undefined,
    );
    expectWholeObserved(observed);
    expect(observed.toolCalls[0]).toMatchObject({ label: 'coverage.check', error: 'service down' });
    expect(observed.toolCalls[1]).toMatchObject({ label: 'port.check', output: 'plain words' });
    expect(observed.text).toBe('Sorry.');
  });

  it('maps the card tools of the Nexus runtime to card segments, after their tool result', () => {
    expect(cardOf('send_message')).toBe('send_message');
    expect(cardOf('display_html')).toBe('display_html');
    expect(cardOf('send_html_template_order_recap')).toBe('order_recap');
    expect(cardOf('coverage.check')).toBeUndefined();
    const withCard = readCandidate(
      {
        content: '',
        toolCalls: [{ name: 'send_message', input: { content: 'Ready to order?' }, output: { sent: true } }],
      },
      'x',
    );
    const observed = observedFromCandidate(withCard, 0, undefined);
    expect(observed.segments).toEqual([
      { type: 'tool_call', label: 'send_message', input: { content: 'Ready to order?' } },
      { type: 'tool_result', label: 'send_message', output: { sent: true } },
      { type: 'card', name: 'send_message', data: { content: 'Ready to order?' } },
    ]);
    expect(observed.text).toBe('');
  });

  it('refuses a generate answer with no candidate reply', () => {
    expect(() => readCandidate({ toolCalls: [] }, 'POST /generate')).toThrow(AgentFailure);
  });
});

describe('nexus adapter, against the fake platform', () => {
  it('opens a golden conversation for the target agent, deployment and variant, the prefix in the history only', async () => {
    const fake = createFakeNexus({ apiKey: KEY, stubs });
    const adapter = on(fake);
    expect(adapter.capabilities()).toEqual({
      variants: true,
      seedPrefix: false,
      toolStubs: false,
      trace: true,
      sandbox: false,
      endState: true,
      deterministic: false,
    });
    const start = acmeGiven(target, {}, [{ role: 'user', content: 'earlier' }]);
    const session = await adapter.open(start);
    expect(fake.requests[0]).toMatchObject({
      method: 'POST',
      path: '/prompt-eval/golden-conversations',
      body: {
        agentId: target.agent,
        deploymentId: target.deployment,
        variant: 'candidate',
        title: `driftbench ${start.hash.slice(0, 12)}`,
      },
    });
    expect(fake.conversations.has(session.id)).toBe(true);
    expect(session.history, 'the record the runner keeps').toEqual([{ role: 'user', content: 'earlier' }]);
    expect(fake.conversations.get(session.id)?.turns, 'the platform conversation holds no turn').toEqual([]);
  });

  it('needs the agent, the deployment and the key, and asks nothing of the platform without them', async () => {
    const fake = createFakeNexus({ apiKey: KEY });
    await expect(on(fake).open(acmeGiven({ ...target, agent: undefined }))).rejects.toThrow(/target\.agent/);
    await expect(on(fake).open(acmeGiven({ ...target, deployment: undefined }))).rejects.toThrow(
      /target\.deployment/,
    );
    await expect(
      on(fake).open(acmeGiven({ ...target, options: { stubs: { 'order.create': 42 } } })),
    ).rejects.toThrow(/target\.options\.stubs/);
    const keyless = nexusAdapter({ env: { NEXUS_BASE_URL: 'https://nexus.test' }, fetch: fake.fetch });
    await expect(keyless.open(acmeGiven(target))).rejects.toThrow(/NEXUS_API_KEY/);
    expect(fake.requests).toEqual([]);
  });

  it('sends the key in the api-key header only, and never puts it in an error', async () => {
    const fake = createFakeNexus({ apiKey: KEY, stubs });
    const adapter = on(fake);
    const session = await adapter.open(acmeGiven(target));
    await adapter.send(session, userTurn(0, COVERAGE_QUESTION, session.given));
    expect(fake.requests.every((request) => request.apiKey === KEY)).toBe(true);
    expect(JSON.stringify(fake.requests.map((request) => request.body))).not.toContain(KEY);

    fake.failNext(/\/generate$/, 400);
    const failure = await adapter
      .send(session, userTurn(1, 'Acme Fiber 300, please.', session.given))
      .catch((e) => e);
    expect(failure).toBeInstanceOf(AgentFailure);
    expect((failure as Error).message).toContain('answered 400: HTTP_400: injected failure');
    expect((failure as Error).message).not.toContain(KEY);

    const wrongKey = nexusAdapter({ env: { NEXUS_API_KEY: 'another-key' }, fetch: fake.fetch });
    const refused = await wrongKey.open(acmeGiven(target)).catch((e) => e);
    expect(refused).toBeInstanceOf(AgentFailure);
    expect((refused as Error).message).toMatch(/401: UNAUTHORIZED/);
    expect((refused as Error).message).not.toContain('another-key');
  });

  it('posts each user message, then generates, then accepts, so the next block replays the turn', async () => {
    const fake = createFakeNexus({ apiKey: KEY, stubs });
    const adapter = on(fake);
    const session = await adapter.open(acmeGiven(target));
    const before = fake.requests.length;
    await adapter.send(session, {
      index: 0,
      stimulus: { burst: ['Hi.', COVERAGE_QUESTION] },
      given: session.given,
    });
    const paths = fake.requests.slice(before).map((request) => request.path.replace(session.id, ':id'));
    expect(paths).toEqual([
      '/prompt-eval/golden-conversations/:id/turns/user',
      '/prompt-eval/golden-conversations/:id/turns/user',
      '/prompt-eval/golden-conversations/:id/generate',
      '/prompt-eval/golden-conversations/:id/accept',
    ]);
    expect(fake.conversations.get(session.id)?.turns.map((turn) => turn.role)).toEqual([
      'user',
      'user',
      'agent',
    ]);
  });

  it('resumes a send the runner retries: no user message twice, no second generate after a lost accept', async () => {
    const fake = createFakeNexus({ apiKey: KEY, stubs });
    const adapter = on(fake);
    const session = await adapter.open(acmeGiven(target));
    const turn = userTurn(0, COVERAGE_QUESTION, session.given);
    fake.failNext(/\/generate$/, 'network');
    await expect(adapter.send(session, turn)).rejects.toBeInstanceOf(AdapterTransportError);
    fake.failNext(/\/accept$/, 503);
    await expect(adapter.send(session, turn)).rejects.toBeInstanceOf(AdapterTransportError);
    const observed = await adapter.send(session, turn);
    expect(observed.toolCalls.map((call) => call.label)).toEqual(['coverage.check', 'catalog.search']);
    const count = (suffix: string) => fake.requests.filter((request) => request.path.endsWith(suffix)).length;
    expect(count('/turns/user')).toBe(1);
    expect(count('/generate'), 'the first generate failed, the second succeeded').toBe(2);
    expect(count('/accept'), 'the first accept failed, the second succeeded').toBe(2);
    expect(fake.conversations.get(session.id)?.turns.map((turn) => turn.role)).toEqual(['user', 'agent']);
  });

  it('traces the turn once the platform has finished writing it', async () => {
    const fake = createFakeNexus({ apiKey: KEY, stubs, traceLag: 2 });
    const adapter = on(fake);
    const session = await adapter.open(acmeGiven(target));
    await expect(adapter.trace?.(session, userTurn(0, 'x', session.given))).rejects.toThrow(
      /no block to trace/,
    );
    const turn = userTurn(0, COVERAGE_QUESTION, session.given);
    const sent = await adapter.send(session, turn);
    const traced = await adapter.trace?.(session, turn);
    expect(traced?.toolCalls.map((call) => call.label)).toEqual(['coverage.check', 'catalog.search']);
    expect(traced?.text).toBe(sent.text);
    expect(traced?.cost).toEqual({ usd: 0.006, inputTokens: 3003, outputTokens: 153 });
    expect(fake.requests.filter((request) => request.path === '/tracing/traces')).toHaveLength(3);
    expect(traced?.raw).toMatchObject({
      conversationId: session.id,
      chatId: expect.stringMatching(/^cafecafe/),
    });
  });

  it('gives up on a trace that never completes with a transport error the runner may retry', async () => {
    const fake = createFakeNexus({ apiKey: KEY, stubs, traceLag: 1_000 });
    const adapter = on(fake, { traceWaitMs: 30 });
    const session = await adapter.open(acmeGiven(target));
    const turn = userTurn(0, COVERAGE_QUESTION, session.given);
    await adapter.send(session, turn);
    await expect(adapter.trace?.(session, turn)).rejects.toBeInstanceOf(AdapterTransportError);
  });

  it('pages the generations of a trace longer than the trace read lists', async () => {
    const fake = createFakeNexus({ apiKey: KEY, stubs, traceWindow: 1 });
    const adapter = on(fake);
    const session = await adapter.open(acmeGiven(target));
    const turn = userTurn(0, COVERAGE_QUESTION, session.given);
    await adapter.send(session, turn);
    const traced = await adapter.trace?.(session, turn);
    expect(traced?.toolCalls.map((call) => call.label)).toEqual(['coverage.check', 'catalog.search']);
    expect(fake.requests.some((request) => request.path === '/tracing/generations')).toBe(true);
  });

  it('reads the payload the stub received from this session, never from another one', async () => {
    const fake = createFakeNexus({ apiKey: KEY, stubs });
    const adapter = on(fake);
    const unlimited = await adapter.open(acmeGiven(target));
    const medium = await adapter.open(acmeGiven(target));
    const choices = { [unlimited.id]: 'The unlimited one, please.', [medium.id]: 'Acme Mobile M, please.' };
    for (const session of [unlimited, medium]) {
      for (const [index, text] of UPGRADE_CONVERSATION.entries()) {
        await converse(adapter, session, index === 2 ? (choices[session.id] ?? text) : text, index);
      }
    }
    expect(fake.executions).toHaveLength(2);
    expect(await adapter.endState?.(unlimited, 'tool:order.create')).toEqual(UPGRADE_PAYLOAD);
    expect(await adapter.endState?.(medium, 'tool:order.create')).toEqual({
      ...UPGRADE_PAYLOAD,
      plan_id: 'mobile-m',
    });
    const listed = fake.requests.filter((request) => request.path === '/workflows/executions').at(-1);
    expect(listed?.query).toMatchObject({ workflowId: STUB_ORDER, sortBy: 'createdAt', order: 'desc' });
    expect(Date.parse(listed?.query.startDate ?? '')).toBeLessThan(Date.now());
    expect(await adapter.endState?.(unlimited, '*')).toEqual([
      { tool: 'order.create', input: UPGRADE_PAYLOAD },
    ]);
    expect(await adapter.endState?.(medium, '*')).toEqual([
      { tool: 'order.create', input: { ...UPGRADE_PAYLOAD, plan_id: 'mobile-m' } },
    ]);
  });

  it('lists one payload per session for source *, when two sessions sent the same order and both were traced', async () => {
    const fake = createFakeNexus({ apiKey: KEY, stubs });
    const adapter = on(fake);
    const first = await adapter.open(acmeGiven(target));
    const second = await adapter.open(acmeGiven(target));
    for (const session of [first, second]) {
      for (const [index, text] of UPGRADE_CONVERSATION.entries()) {
        await converse(adapter, session, text, index);
        await adapter.trace?.(session, userTurn(index, text, session.given));
      }
    }
    expect(fake.executions, 'the stub received the same payload twice').toHaveLength(2);
    for (const session of [first, second]) {
      expect(await adapter.endState?.(session, '*')).toEqual([
        { tool: 'order.create', input: UPGRADE_PAYLOAD },
      ]);
    }
  });

  it('lists a payload for source * once, when a second identical call never reached the stub', async () => {
    const fake = createFakeNexus({ apiKey: KEY, stubs });
    const adapter = on(fake);
    const session = await adapter.open(acmeGiven(target));
    for (const [index, text] of UPGRADE_CONVERSATION.entries()) await converse(adapter, session, text, index);
    const state = session.state as { calls: { block: number; label: string; input: unknown }[] };
    state.calls.push({ block: 99, label: 'order.create', input: UPGRADE_PAYLOAD });
    expect(await adapter.endState?.(session, '*')).toEqual([
      { tool: 'order.create', input: UPGRADE_PAYLOAD },
    ]);
  });

  it('lists each payload once for source *, after a trace read the same calls again', async () => {
    const fake = createFakeNexus({ apiKey: KEY, stubs });
    const adapter = on(fake);
    const session = await adapter.open(acmeGiven(target));
    for (const [index, text] of UPGRADE_CONVERSATION.entries()) {
      await converse(adapter, session, text, index);
      await adapter.trace?.(session, userTurn(index, text, session.given));
      await adapter.trace?.(session, userTurn(index, text, session.given));
    }
    expect(await adapter.endState?.(session, '*')).toEqual([
      { tool: 'order.create', input: UPGRADE_PAYLOAD },
    ]);
  });

  it('reads undefined when the session never called the tool, and refuses a tool with no stub', async () => {
    const fake = createFakeNexus({ apiKey: KEY, stubs });
    const adapter = on(fake);
    const session = await adapter.open(
      acmeGiven({ ...target, options: { stubs: { 'order.create': STUB_ORDER } } }),
    );
    await converse(adapter, session, COVERAGE_QUESTION, 0);
    const reads = fake.requests.length;
    expect(await adapter.endState?.(session, 'tool:order.create')).toBeUndefined();
    expect(await adapter.endState?.(session, '*')).toEqual([]);
    expect(fake.requests.length, 'no call of a stubbed tool: nothing to read').toBe(reads);
    await expect(adapter.endState?.(session, 'tool:notify_sales')).rejects.toThrow(
      /no recording stub for tool notify_sales/,
    );
    await expect(adapter.endState?.(session, 'payloads')).rejects.toThrow(/tool:<label> or \*/);
  });

  it('maps platform failures by the shared retry rule: 408, 429, 5xx and a dropped connection may be retried, 404 fails the block', async () => {
    const fake = createFakeNexus({ apiKey: KEY, stubs });
    const adapter = on(fake);
    for (const [failure, kind] of [
      [503, AdapterTransportError],
      [429, AdapterTransportError],
      [500, AdapterTransportError],
      ['network', AdapterTransportError],
      [408, AdapterTransportError],
      [404, AgentFailure],
    ] as const) {
      fake.failNext(/^\/prompt-eval\/golden-conversations$/, failure);
      await expect(adapter.open(acmeGiven(target)), String(failure)).rejects.toBeInstanceOf(kind);
    }
    const envelope = nexusAdapter({
      env,
      fetch: async () => new Response(JSON.stringify(fixture('error.json')), { status: 404 }),
    });
    await expect(envelope.open(acmeGiven(target))).rejects.toThrow(
      'POST /prompt-eval/golden-conversations answered 404: NOT_FOUND: Golden conversation not found',
    );
  });

  it('deletes the conversation on close, keeps it when asked, and takes a conversation already gone as released', async () => {
    const fake = createFakeNexus({ apiKey: KEY, stubs });
    const deleting = on(fake);
    const session = await deleting.open(acmeGiven(target));
    await deleting.close(session);
    await deleting.close(session);
    expect(fake.deleted.has(session.id)).toBe(true);
    expect(fake.requests.filter((request) => request.method === 'DELETE')).toHaveLength(1);

    const keeping = on(fake, { keepConversations: true });
    const kept = await keeping.open(acmeGiven(target));
    await keeping.close(kept);
    expect(fake.conversations.has(kept.id)).toBe(true);

    const gone = await deleting.open(acmeGiven(target));
    fake.conversations.delete(gone.id);
    await expect(deleting.close(gone)).resolves.toBeUndefined();
  });

  it('answers in the captured shapes: the fields of every fixture, and no other', async () => {
    const fake = createFakeNexus({ apiKey: KEY, stubs, traceWindow: 1 });
    const adapter = on(fake);
    const session = await adapter.open(acmeGiven(target));
    for (const [index, text] of UPGRADE_CONVERSATION.entries()) await converse(adapter, session, text, index);
    await adapter.trace?.(session, userTurn(3, 'Confirm', session.given));
    await adapter.endState?.(session, 'tool:order.create');
    await adapter.close(session);

    const shapes = new Map<string, string>();
    const keysOf = (value: unknown) => {
      const row = Array.isArray(value) ? value[0] : value;
      return Object.keys(row as object)
        .sort()
        .join(',');
    };
    for (const request of fake.requests) {
      const answered = request.answer?.body as { success?: boolean; data?: unknown } | undefined;
      if (request.answer?.status !== 200 || !answered?.success) continue;
      shapes.set(
        `${request.method} ${request.path.replace(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, ':id')}`,
        keysOf(answered.data),
      );
    }
    const expected: [string, string][] = [
      ['POST /prompt-eval/golden-conversations', 'golden-conversation.create.json'],
      ['POST /prompt-eval/golden-conversations/:id/turns/user', 'golden-conversation.turn-user.json'],
      ['POST /prompt-eval/golden-conversations/:id/generate', 'golden-conversation.generate.json'],
      ['POST /prompt-eval/golden-conversations/:id/accept', 'golden-conversation.accept.json'],
      ['DELETE /prompt-eval/golden-conversations/:id', 'golden-conversation.delete.json'],
      ['GET /emulator/:id/sessions/:id', 'emulator-session.json'],
      ['GET /tracing/traces', 'tracing-traces.json'],
      ['GET /tracing/traces/:id', 'tracing-trace.json'],
      ['GET /tracing/generations', 'tracing-generations.json'],
      ['GET /tracing/generations/:id', 'tracing-generation-1.json'],
      ['GET /workflows/executions', 'workflow-executions.json'],
      ['GET /workflows/executions/:id', 'workflow-execution.json'],
    ];
    for (const [route, file] of expected) {
      expect(shapes.get(route), route).toBe(keysOf(fixture(file).data));
    }
  });
});
