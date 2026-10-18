import {
  AdapterTransportError,
  AgentFailure,
  collectRetries,
  type Message,
  type Session,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { WireNames } from '../src/anthropic/common';
import { GOOGLE_NAME, toGoogleContents } from '../src/google/contents';
import { googleAdapter } from '../src/google/index';
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
import { deadGoogle, FakeGoogleError, fakeGoogle, recordedGoogle } from './fixtures/sdk/google';
import recorded from './fixtures/sdk/recorded/google-coverage.json';

const MODEL = 'gemini-fake-acme';
const SYSTEM = 'You are the Acme Telecom sales assistant.';

function acme() {
  return googleAdapter({
    client: fakeGoogle(),
    model: MODEL,
    system: SYSTEM,
    tools: () => acmeTools().tools,
    sideEffects: ACME_SIDE_EFFECTS,
    deterministic: true,
  });
}

adapterContract('google', acme, {
  brokenTransport: () => googleAdapter({ client: deadGoogle(), model: MODEL, sleep: async () => {} }),
  released: (session: Session) => (session.state as { closed?: boolean }).closed === true,
});

const given = acmeGiven({ adapter: 'google' });

/** A client that answers each call with the next scripted parts, and records the requests. */
function scripted(...answers: { parts: unknown[]; finishReason?: string; usageMetadata?: unknown }[]) {
  return recordedGoogle(
    answers.map(({ parts, finishReason, usageMetadata }) => ({
      candidates: [{ content: { role: 'model', parts }, finishReason: finishReason ?? 'STOP' }],
      ...(usageMetadata ? { usageMetadata } : {}),
    })),
  );
}

describe('google adapter', () => {
  it('validates and freezes messages before the tools factory receives the Given', async () => {
    let called = 0;
    const adapter = googleAdapter({
      client: fakeGoogle(),
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

  it('replays a recorded exchange: the contents, instruction and declarations the real SDK sent, and the whole turn', async () => {
    const client = recordedGoogle(recorded.exchanges.map((exchange) => exchange.response));
    const adapter = googleAdapter({ client, model: MODEL, system: SYSTEM, tools: () => acmeTools().tools });
    const observed = await sendUser(adapter, await adapter.open(given), COVERAGE_QUESTION, 0);
    // The SDK moves `config` to the top of the REST body and wraps the system instruction as a content.
    client.requests.forEach((params, index) => {
      const sent = recorded.exchanges[index]?.request;
      expect(params.model).toBe(MODEL);
      expect(params.contents, `contents of request ${index}`).toEqual(sent?.contents);
      expect(params.config?.tools).toEqual(sent?.tools);
      expect({ parts: [{ text: params.config?.systemInstruction }], role: 'user' }).toEqual(
        sent?.systemInstruction,
      );
    });
    expectWholeObserved(observed);
    expect(observed.toolCalls.map((call) => call.label)).toEqual(['coverage.check', 'catalog.search']);
    expect(observed.toolCalls.map((call) => call.id)).toEqual(['fc_fake_1', 'fc_fake_2']);
    expect(observed.raw).toEqual({ finishReasons: ['STOP', 'STOP', 'STOP'] });
    const usage = recorded.exchanges.map((exchange) => exchange.response.usageMetadata);
    expect(observed.cost).toEqual({
      inputTokens: usage.reduce((sum, entry) => sum + entry.promptTokenCount, 0),
      outputTokens: usage.reduce((sum, entry) => sum + entry.candidatesTokenCount, 0),
    });
  });

  it('sends a signed function call back with its signature, and leaves thoughts out of the text', async () => {
    const client = scripted(
      {
        parts: [
          { text: 'Checking the address first.', thought: true },
          {
            functionCall: { id: 'fc_1', name: 'coverage.check', args: { address: 'x' } },
            thoughtSignature: 'sig-1',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 6 },
      },
      {
        parts: [{ text: 'Fiber is there.' }],
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 5 },
      },
    );
    const adapter = googleAdapter({
      client,
      model: MODEL,
      tools: [{ name: 'coverage.check', run: () => ({ found: true }) }],
    });
    const observed = await sendUser(adapter, await adapter.open(given), 'hi', 0);
    expectWholeObserved(observed);
    expect(observed.text).toBe('Fiber is there.');
    expect(observed.cost, 'thinking tokens are billed as output').toEqual({
      inputTokens: 40,
      outputTokens: 15,
    });
    expect(client.requests[1]?.contents.slice(1)).toEqual([
      {
        role: 'model',
        parts: [
          { text: 'Checking the address first.', thought: true },
          {
            functionCall: { id: 'fc_1', name: 'coverage.check', args: { address: 'x' } },
            thoughtSignature: 'sig-1',
          },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { id: 'fc_1', name: 'coverage.check', response: { output: { found: true } } } },
        ],
      },
    ]);
  });

  it('gives a call without an id one for its segments, and sends its response without an id', async () => {
    const client = scripted(
      {
        parts: [
          { functionCall: { name: 'coverage.check', args: {} } },
          { functionCall: { name: 'coverage.check', args: {} } },
        ],
      },
      { parts: [{ text: 'done' }] },
    );
    const world = { tools: { 'coverage.check': { error: 'coverage service unavailable' } } };
    const start = acmeGiven({ adapter: 'google' }, world);
    const adapter = googleAdapter({ client, model: MODEL, tools: [{ name: 'coverage.check' }] });
    const observed = await sendUser(adapter, await adapter.open(start), 'hi', 0, start);
    expectWholeObserved(observed);
    expect(observed.toolCalls.map((call) => [call.id, call.error])).toEqual([
      ['fc-0-1-1', 'coverage service unavailable'],
      ['fc-0-1-2', 'coverage service unavailable'],
    ]);
    expect(client.requests[1]?.contents.at(-1)).toEqual({
      role: 'user',
      parts: [
        { functionResponse: { name: 'coverage.check', response: { error: 'coverage service unavailable' } } },
        { functionResponse: { name: 'coverage.check', response: { error: 'coverage service unavailable' } } },
      ],
    });
  });

  it('encodes the history as user and model contents, outputs as { output } and errors as { error }', () => {
    const history: Message[] = [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Coverage at 9 Elm Street?' },
      {
        role: 'assistant',
        content: 'No fiber there.',
        tool_calls: [
          { id: 'c1', label: 'coverage check', input: 'raw text', error: 'timeout' },
          { label: 'coverage check', input: { address: '9 Elm Street' }, output: { found: false } },
        ],
      },
      { role: 'tool', content: 'a free note' },
    ];
    const { contents, system } = toGoogleContents(history, new WireNames([], GOOGLE_NAME, 128));
    expect(system).toEqual(['Be brief.']);
    expect(contents).toEqual([
      { role: 'user', parts: [{ text: 'Coverage at 9 Elm Street?' }] },
      {
        role: 'model',
        parts: [
          { functionCall: { id: 'c1', name: 'coverage_check', args: { value: 'raw text' } } },
          { functionCall: { name: 'coverage_check', args: { address: '9 Elm Street' } } },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { id: 'c1', name: 'coverage_check', response: { error: 'timeout' } } },
          { functionResponse: { name: 'coverage_check', response: { output: { found: false } } } },
        ],
      },
      { role: 'model', parts: [{ text: 'No fiber there.' }] },
      { role: 'user', parts: [{ text: 'a free note' }] },
    ]);
  });

  it('fails the block on a blocked prompt, at the step cap, and on a transport or request error by kind', async () => {
    const blocked = googleAdapter({
      client: recordedGoogle([{ promptFeedback: { blockReason: 'SAFETY' } }]),
      model: MODEL,
    });
    await expect(sendUser(blocked, await blocked.open(given), 'hi', 0)).rejects.toThrow(
      /prompt was blocked \(SAFETY\)/,
    );

    let calls = 0;
    const looping = googleAdapter({
      client: {
        models: {
          generateContent: async () => {
            calls++;
            return {
              candidates: [
                {
                  content: { role: 'model', parts: [{ functionCall: { name: 'coverage.check', args: {} } }] },
                },
              ],
            };
          },
        },
      },
      model: MODEL,
      tools: [{ name: 'coverage.check', run: () => ({}) }],
      maxSteps: 4,
    });
    await expect(sendUser(looping, await looping.open(given), 'hi', 0)).rejects.toThrow(
      /after 4 model calls/,
    );
    expect(calls).toBe(4);

    const failing = (error: unknown) =>
      googleAdapter({
        client: { models: { generateContent: async () => Promise.reject(error) } },
        model: MODEL,
        sleep: async () => {},
      });
    const sent = async (error: unknown) => {
      const adapter = failing(error);
      return sendUser(adapter, await adapter.open(given), 'hi', 0).catch((caught: unknown) => caught);
    };
    expect(await sent(new FakeGoogleError(503, 'UNAVAILABLE'))).toBeInstanceOf(AdapterTransportError);
    expect(await sent(new FakeGoogleError(429, 'RESOURCE_EXHAUSTED'))).toBeInstanceOf(AdapterTransportError);
    expect(await sent(new FakeGoogleError(400, 'INVALID_ARGUMENT'))).toBeInstanceOf(AgentFailure);
    expect(await sent(new FakeGoogleError(403, 'PERMISSION_DENIED'))).toBeInstanceOf(AgentFailure);
    const notObject = googleAdapter({
      client: { models: { generateContent: async () => 'text' as never } },
      model: MODEL,
    });
    await expect(sendUser(notObject, await notObject.open(given), 'hi', 0)).rejects.toBeInstanceOf(
      AgentFailure,
    );
  });

  it('retries a call that fails with a 503 then a refused connection, and records both retries', async () => {
    let calls = 0;
    const inner = fakeGoogle();
    const adapter = googleAdapter({
      client: {
        models: {
          async generateContent(params) {
            calls += 1;
            if (calls === 1) throw new FakeGoogleError(503, 'UNAVAILABLE');
            if (calls === 2) {
              throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
            }
            return inner.models.generateContent(params);
          },
        },
      },
      model: MODEL,
      tools: () => acmeTools().tools,
      sleep: async () => {},
    });
    const session = await adapter.open(given);
    session.history.push({ role: 'user', content: COVERAGE_QUESTION });
    const { value: observed, retries } = await collectRetries(() =>
      adapter.send(session, { index: 0, stimulus: { user: COVERAGE_QUESTION }, given }),
    );
    expectWholeObserved(observed);
    expect(observed.toolCalls.map((call) => call.label)).toEqual(['coverage.check', 'catalog.search']);
    expect(retries.map((event) => [event.attempt, event.status ?? 'network'])).toEqual([
      [1, 503],
      [2, 'network'],
    ]);
  });

  it('reads the order payload after the upgrade, and nothing for a tool that received none', async () => {
    const adapter = acme();
    const session = await adapter.open(given);
    for (const [index, text] of [
      "Hi, I'm already an Acme customer and I keep running out of data on my phone.",
      "It's sam.rivera@example.com",
      'The unlimited one, please.',
      'Confirm',
    ].entries()) {
      await converse(adapter, session, text, index);
    }
    expect(await adapter.endState?.(session, 'tool:order.create')).toEqual({
      type: 'upgrade',
      customer_id: 'cust-001',
      plan_id: 'mobile-l',
    });
    expect(await adapter.endState?.(session, 'tool:notify_sales')).toBeUndefined();
    const bare = googleAdapter({ client: fakeGoogle(), model: MODEL });
    expect(bare.capabilities().endState).toBe(false);
    await expect(bare.endState?.(await bare.open(given), '*')).rejects.toThrow(/names no sideEffects/);
  });
});
