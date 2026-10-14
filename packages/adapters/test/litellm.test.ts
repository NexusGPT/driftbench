import {
  AdapterTransportError,
  AgentFailure,
  collectRetries,
  type Session,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { litellmAdapter } from '../src/litellm/index';
import { acmeGiven, adapterContract, COVERAGE_QUESTION, expectWholeObserved, sendUser } from './contract';
import { deadLitellm, FakeOpenAIError, fakeLitellm } from './fixtures/frameworks/litellm';
import { ACME_SIDE_EFFECTS } from './fixtures/sdk/acme-model';
import { acmeTools } from './fixtures/sdk/acme-tools';

const MODEL = 'acme-sales-model';

adapterContract(
  'litellm',
  () =>
    litellmAdapter({
      client: fakeLitellm(),
      model: MODEL,
      system: 'You are the Acme Telecom sales assistant.',
      tools: () => acmeTools().tools,
      sideEffects: ACME_SIDE_EFFECTS,
      deterministic: true,
    }),
  {
    brokenTransport: () => litellmAdapter({ client: deadLitellm(), model: MODEL, sleep: async () => {} }),
    released: (session: Session) => (session.state as { closed?: boolean }).closed === true,
  },
);

const given = acmeGiven({ adapter: 'litellm' });

describe('litellm adapter', () => {
  it('validates and freezes messages before the tools factory receives the Given', async () => {
    let called = 0;
    const adapter = litellmAdapter({
      client: fakeLitellm(),
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

  it('sends the OpenAI chat shape with names the providers accept, the client retries off, and keeps the routed model', async () => {
    const client = fakeLitellm('openai/gpt-fake');
    const adapter = litellmAdapter({
      client,
      model: MODEL,
      system: 'Be brief.',
      tools: () => acmeTools().tools,
    });
    const observed = await sendUser(adapter, await adapter.open(given), COVERAGE_QUESTION, 0);
    expectWholeObserved(observed);
    expect(observed.toolCalls.map((call) => call.label)).toEqual(['coverage.check', 'catalog.search']);
    const first = client.requests[0];
    expect(first?.options).toEqual({ maxRetries: 0 });
    expect(first?.body.messages[0]).toEqual({ role: 'system', content: 'Be brief.' });
    expect(first?.body.tools?.map((tool) => tool.function.name)).toEqual([
      'catalog_search',
      'coverage_check',
      'port_check',
      'order_create',
      'notify_sales',
    ]);
    const second = client.requests[1]?.body.messages;
    expect(second?.at(-2)).toMatchObject({
      role: 'assistant',
      tool_calls: [{ function: { name: 'coverage_check' } }],
    });
    expect(second?.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_fake_1' });
    expect(observed.raw).toEqual({
      finishReasons: ['tool_calls', 'tool_calls', 'stop'],
      models: ['openai/gpt-fake', 'openai/gpt-fake', 'openai/gpt-fake'],
    });
    expect(observed.cost.inputTokens).toBeGreaterThan(0);
  });

  it('retries a call that fails twice, 429 with Retry-After then 503, and records both retries', async () => {
    const inner = fakeLitellm();
    let calls = 0;
    const waits: number[] = [];
    const client = {
      chat: {
        completions: {
          create: async (
            body: Parameters<typeof inner.chat.completions.create>[0],
            options?: { maxRetries?: number },
          ) => {
            calls += 1;
            if (calls === 1)
              throw new FakeOpenAIError(
                429,
                'rate limited',
                new Headers({ 'retry-after': '1' }),
                'RateLimitError',
              );
            if (calls === 2)
              throw new FakeOpenAIError(503, 'no healthy deployment', undefined, 'InternalServerError');
            return inner.chat.completions.create(body, options);
          },
        },
      },
    };
    const adapter = litellmAdapter({
      client,
      model: MODEL,
      tools: () => acmeTools().tools,
      retry: { jitter: false, baseDelayMs: 50 },
      sleep: async (ms) => void waits.push(ms),
    });
    const session = await adapter.open(given);
    session.history.push({ role: 'user', content: COVERAGE_QUESTION });
    const { value, retries } = await collectRetries(() =>
      adapter.send(session, { index: 0, stimulus: { user: COVERAGE_QUESTION }, given }),
    );
    expectWholeObserved(value);
    expect(waits).toEqual([1_000, 100]);
    expect(retries.map((event) => [event.attempt, event.status, event.delayMs])).toEqual([
      [1, 429, 1_000],
      [2, 503, 100],
    ]);
  });

  it('fails a refused request at once, and stops a model that keeps asking for tools', async () => {
    const refusing = litellmAdapter({
      client: {
        chat: {
          completions: {
            create: async () =>
              Promise.reject(new FakeOpenAIError(401, 'bad key', undefined, 'AuthenticationError')),
          },
        },
      },
      model: MODEL,
      sleep: async () => {},
    });
    await expect(sendUser(refusing, await refusing.open(given), 'hi', 0)).rejects.toBeInstanceOf(
      AgentFailure,
    );
    const overloaded = litellmAdapter({
      client: {
        chat: { completions: { create: async () => Promise.reject(new FakeOpenAIError(529, 'overloaded')) } },
      },
      model: MODEL,
      sleep: async () => {},
    });
    await expect(sendUser(overloaded, await overloaded.open(given), 'hi', 0)).rejects.toMatchObject({
      name: 'AdapterTransportError',
      exhausted: true,
    });
    let calls = 0;
    const looping = litellmAdapter({
      client: {
        chat: {
          completions: {
            create: async () => {
              calls += 1;
              return {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content: null,
                      tool_calls: [
                        {
                          id: `c${calls}`,
                          type: 'function',
                          function: { name: 'coverage_check', arguments: '{}' },
                        },
                      ],
                    },
                  },
                ],
              };
            },
          },
        },
      },
      model: MODEL,
      tools: [{ name: 'coverage.check', run: () => ({ found: true }) }],
      maxSteps: 3,
    });
    await expect(sendUser(looping, await looping.open(given), 'hi', 0)).rejects.toThrow(
      /after 3 model calls/,
    );
    expect(calls).toBe(3);
    expect(AdapterTransportError).toBeDefined();
  });
});
