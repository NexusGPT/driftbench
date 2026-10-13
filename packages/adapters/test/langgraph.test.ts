import {
  AdapterTransportError,
  AgentFailure,
  type Message,
  type Session,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { ToolLabels } from '../src/anthropic/common';
import { langgraphAdapter } from '../src/langgraph/index';
import { kindOf, toLangChainMessages } from '../src/langgraph/messages';
import {
  acmeGiven,
  adapterContract,
  COVERAGE_QUESTION,
  converse,
  expectWholeObserved,
  PLAN_CHOICE,
  sendUser,
} from './contract';
import { ACME_SIDE_EFFECTS, ACME_TOOL_NAMES } from './fixtures/sdk/acme-model';
import { deadGraph, type FakeGraph, fakeGraph, recordedGraph } from './fixtures/sdk/langgraph';
import recorded from './fixtures/sdk/recorded/langgraph-coverage.json';

let lastGraph: FakeGraph | undefined;

function acme(checkpointed: boolean) {
  return () => {
    lastGraph = fakeGraph({ checkpointed });
    return langgraphAdapter({
      graph: lastGraph,
      toolLabels: ACME_TOOL_NAMES,
      sideEffects: ACME_SIDE_EFFECTS,
      deterministic: true,
    });
  };
}

describe('a graph compiled with a checkpointer', () => {
  adapterContract('langgraph', acme(true), {
    brokenTransport: () => langgraphAdapter({ graph: deadGraph() }),
    released: (session: Session) => {
      const thread = (session.state as { threadId: string }).threadId;
      return lastGraph?.saver?.threads.has(thread) === false;
    },
  });
});

describe('a graph compiled without a checkpointer', () => {
  adapterContract('langgraph', acme(false), {
    brokenTransport: () => langgraphAdapter({ graph: deadGraph() }),
    released: (session: Session) => (session.state as { closed?: boolean }).closed === true,
  });
});

const given = acmeGiven({ adapter: 'langgraph' });
const labels = new ToolLabels(ACME_TOOL_NAMES);

describe('langgraph adapter', () => {
  it('replays a recorded state, messages in the serialized form JSON writes, as the whole turn', async () => {
    const graph = recordedGraph([{ messages: recorded.messages }]);
    const adapter = langgraphAdapter({ graph, toolLabels: ACME_TOOL_NAMES });
    const observed = await sendUser(adapter, await adapter.open(given), COVERAGE_QUESTION, 0);
    expectWholeObserved(observed);
    expect(observed.toolCalls.map((call) => [call.id, call.label])).toEqual([
      ['call_1', 'coverage.check'],
      ['call_2', 'catalog.search'],
    ]);
    expect(observed.toolCalls[1]?.output).toMatchObject({ plans: [{ id: 'fiber-300' }, { id: 'air-5g' }] });
    expect(observed.text).toContain('3 Orchard Way, Acmeville has fiber up to 300 Mbps');
    expect(observed.cost).toEqual({ inputTokens: 30, outputTokens: 15 });
    expect(graph.invocations[0]?.input).toEqual([{ role: 'user', content: COVERAGE_QUESTION }]);
  });

  it('sends the whole history to a graph without a checkpointer, and only the new user turn to a checkpointed thread', async () => {
    const stateless = fakeGraph({ checkpointed: false });
    const one = langgraphAdapter({ graph: stateless, toolLabels: ACME_TOOL_NAMES });
    const a = await one.open(given);
    await converse(one, a, COVERAGE_QUESTION, 0);
    await converse(one, a, PLAN_CHOICE, 1);
    expect(stateless.invocations.map((call) => call.input.length)).toEqual([1, 6]);
    expect(stateless.invocations[1]?.input[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ name: 'coverage_check' }, { name: 'catalog_search' }],
    });

    const stateful = fakeGraph({ checkpointed: true });
    const two = langgraphAdapter({
      graph: stateful,
      toolLabels: ACME_TOOL_NAMES,
      threadId: (id) => `acme-${id}`,
    });
    const prefix: Message[] = [{ role: 'system', content: 'Be brief.' }];
    const b = await two.open(acmeGiven({ adapter: 'langgraph' }, {}, prefix));
    await converse(two, b, COVERAGE_QUESTION, 0);
    const second = await converse(two, b, PLAN_CHOICE, 1);
    expect(stateful.invocations.map((call) => call.input)).toEqual([
      [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: COVERAGE_QUESTION },
      ],
      [{ role: 'user', content: PLAN_CHOICE }],
    ]);
    expect(stateful.invocations[0]?.config).toEqual({ configurable: { thread_id: `acme-${b.id}` } });
    expect(second.text).toContain('Acme Fiber 300');
  });

  it('reads the checkpoint as state sources, and refuses them on a graph without a checkpointer', async () => {
    const graph = fakeGraph({ checkpointed: true });
    const adapter = langgraphAdapter({ graph });
    expect(adapter.capabilities().endState).toBe(true);
    const session = await adapter.open(given);
    await converse(adapter, session, COVERAGE_QUESTION, 0);
    const values = (await adapter.endState?.(session, 'state')) as { messages: unknown[] };
    expect(values.messages.map(kindOf)).toEqual(['human', 'ai', 'tool', 'ai', 'tool', 'ai']);
    expect(await adapter.endState?.(session, 'state:messages')).toEqual(values.messages);
    expect(await adapter.endState?.(session, 'state:nothing')).toBeUndefined();
    expect(await adapter.endState?.(session, '*'), 'no sideEffects named: no payload').toEqual([]);

    const stateless = langgraphAdapter({ graph: fakeGraph({ checkpointed: false }) });
    expect(stateless.capabilities().endState).toBe(false);
    await expect(stateless.endState?.(await stateless.open(given), 'state')).rejects.toThrow(
      /compiled with a checkpointer/,
    );
  });

  it('maps a tool error, a remote dict state, and an interrupt with the call it left open', async () => {
    const graph = recordedGraph([
      {
        messages: [
          { type: 'human', content: 'hi' },
          {
            type: 'ai',
            content: '',
            tool_calls: [{ id: 't1', name: 'coverage_check', args: { address: 'x' } }],
          },
          {
            type: 'tool',
            tool_call_id: 't1',
            name: 'coverage_check',
            content: 'Error: address unknown',
            status: 'error',
          },
          {
            type: 'ai',
            content: [{ type: 'text', text: 'Which address?' }],
            tool_calls: [{ id: 't2', name: 'order_create', args: { plan_id: 'p' } }],
          },
        ],
        __interrupt__: [{ value: { question: 'Approve the order?' }, id: 'int-1' }],
      },
    ]);
    const adapter = langgraphAdapter({ graph, toolLabels: ACME_TOOL_NAMES });
    const observed = await sendUser(adapter, await adapter.open(given), 'hi', 0);
    expectWholeObserved(observed);
    expect(observed.segments.map((segment) => segment.type)).toEqual([
      'tool_call',
      'tool_result',
      'text',
      'tool_call',
      'card',
      'tool_result',
    ]);
    expect(observed.toolCalls).toEqual([
      { id: 't1', label: 'coverage.check', input: { address: 'x' }, error: 'Error: address unknown' },
      {
        id: 't2',
        label: 'order.create',
        input: { plan_id: 'p' },
        error: 'the graph stopped before the tool answered',
      },
    ]);
    expect(observed.segments[4]).toEqual({
      type: 'card',
      name: 'interrupt',
      data: [{ question: 'Approve the order?' }],
    });
  });

  it('writes the history as message-like dicts under the graph tool names', () => {
    const history: Message[] = [
      { role: 'user', content: 'Coverage?' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { label: 'coverage.check', input: { address: '9 Elm Street' }, error: 'timeout' },
          { id: 'k2', label: 'coverage.check', input: 'raw', output: { found: true } },
        ],
      },
      { role: 'tool', content: 'a free note' },
    ];
    expect(toLangChainMessages(history, labels)).toEqual([
      { role: 'user', content: 'Coverage?' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_h1', name: 'coverage_check', args: { address: '9 Elm Street' } },
          { id: 'k2', name: 'coverage_check', args: {} },
        ],
      },
      { role: 'tool', tool_call_id: 'call_h1', name: 'coverage_check', content: 'timeout', status: 'error' },
      { role: 'tool', tool_call_id: 'k2', name: 'coverage_check', content: '{"found":true}' },
      { role: 'user', content: 'a free note' },
    ]);
    expect([
      kindOf(null),
      kindOf({ role: 'user' }),
      kindOf({ role: 'assistant' }),
      kindOf({ lc: 1, type: 'constructor', id: ['x', 'SystemMessage'], kwargs: {} }),
    ]).toEqual(['unknown', 'human', 'ai', 'system']);
  });

  it('fails the block on a recursion limit or a state with no messages, retries on a transport failure, and deletes the thread on close', async () => {
    const graph = fakeGraph({ checkpointed: true });
    const capped = langgraphAdapter({ graph, recursionLimit: 2 });
    await expect(sendUser(capped, await capped.open(given), COVERAGE_QUESTION, 0)).rejects.toThrow(
      /Recursion limit of 2/,
    );
    const noMessages = langgraphAdapter({ graph: recordedGraph([{ value: 1 }]) });
    await expect(sendUser(noMessages, await noMessages.open(given), 'hi', 0)).rejects.toBeInstanceOf(
      AgentFailure,
    );
    const dead = langgraphAdapter({ graph: deadGraph() });
    await expect(sendUser(dead, await dead.open(given), 'hi', 0)).rejects.toBeInstanceOf(
      AdapterTransportError,
    );

    const kept = fakeGraph({ checkpointed: true });
    const adapter = langgraphAdapter({ graph: kept });
    const session = await adapter.open(given);
    await converse(adapter, session, COVERAGE_QUESTION, 0);
    expect(kept.saver?.threads.size).toBe(1);
    await adapter.close(session);
    expect(kept.saver?.threads.size).toBe(0);
    await expect(converse(adapter, session, PLAN_CHOICE, 1)).rejects.toThrow(/is closed/);
  });
});
