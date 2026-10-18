import { fileURLToPath } from 'node:url';
import { canonicalGiven, findSpecFiles, loadSpecFile, type Message } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { ToolLabels, UNRECORDED_RESULT, WireNames } from '../src/anthropic/common';
import { ANTHROPIC_NAME, toAnthropicMessages } from '../src/anthropic/messages';
import { toGoogleContents } from '../src/google/contents';
import { toChatMessages } from '../src/http/chat';
import { toInputItems } from '../src/openai-agents/items';
import { HistoryCompiler } from '../src/shared/history';
import { carried, fromAnthropic, fromChat, fromResponses, pairingProblems, WIRES } from './history-wires';

// Fictional data only.
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** A history the wires refuse when rendered naively, one hazard per message. */
const hazards: Message[] = [
  { role: 'system', content: 'You are the Acme sales assistant.' },
  { role: 'user', content: 'Is fiber available at 3 Orchard Way?' },
  {
    role: 'assistant',
    content: 'Yes, fiber is available.',
    tool_calls: [
      // The Acme agent numbers its calls from 1 in every turn, and here twice in one turn.
      { id: 'call-1', label: 'coverage.check', input: { address: '3 Orchard Way' }, output: { found: true } },
      {
        id: 'call-1',
        label: 'catalog.search',
        input: { category: 'fiber' },
        output: { plans: ['fiber-300'] },
      },
    ],
  },
  { role: 'tool', content: 'a free tool note, answering no call' },
  { role: 'user', content: 'And at 4 Orchard Way?' },
  {
    role: 'assistant',
    content: '',
    tool_calls: [
      // Two ids that one wire's cleaning makes equal, a call with no id, and a call with no recorded result.
      { id: 'a.b', label: 'coverage.check', input: { address: '4 Orchard Way' }, error: 'address unknown' },
      { id: 'a_b', label: 'coverage.check', input: { address: '4 Orchard Way, Acmeville' } },
      { label: 'catalog.search' },
    ],
  },
  { role: 'assistant', content: 'I could not find that address.' },
  { role: 'user', content: 'Thanks.' },
  {
    role: 'assistant',
    content: 'Anything else?',
    tool_calls: [
      { id: 'call-1', label: 'notify_sales', input: { topic: 'fiber' }, output: { ref: 'LD-4471' } },
    ],
  },
];

describe('the tool history compiler', () => {
  it('keeps recorded ids, gives a call without one the next fallback, and counts as the wire did', () => {
    const fresh = new HistoryCompiler({ fallback: (n) => `call_h${n}` });
    const every = new HistoryCompiler({ fallback: (n) => `toolu_h${n}`, count: 'every' });
    const message: Message = {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'x', label: 'a', output: 1 },
        { label: 'b', output: 2 },
        { label: 'c', error: 'no' },
      ],
    };
    expect(fresh.calls(message).map((call) => call.id)).toEqual(['x', 'call_h1', 'call_h2']);
    expect(fresh.calls(message).map((call) => call.id)).toEqual(['x', 'call_h3', 'call_h4']);
    expect(every.calls(message).map((call) => call.id)).toEqual(['x', 'toolu_h2', 'toolu_h3']);
    expect(fresh.calls({ role: 'user', content: 'hi' })).toEqual([]);
  });

  it('pairs every call with its result: the output, the error, or the unrecorded value', () => {
    const calls = new HistoryCompiler({ fallback: (n) => `c${n}` }).calls(hazards[5] as Message);
    expect(calls.map((call) => call.result)).toEqual([
      { kind: 'error', message: 'address unknown' },
      { kind: 'output', value: UNRECORDED_RESULT },
      { kind: 'output', value: UNRECORDED_RESULT },
    ]);
  });

  it('gives a fresh id to a call whose id repeats one of the same turn, never one a call of that turn holds', () => {
    const compiler = new HistoryCompiler({ fallback: (n) => `c${n}`, clean: (id) => id.replace(/\./g, '_') });
    const ids = (message: Message) => compiler.calls(message).map((call) => call.id);
    expect(ids(hazards[2] as Message)).toEqual(['call-1', 'c1']);
    expect(ids(hazards[5] as Message)).toEqual(['a_b', 'c2', 'c3']);
    // Across turns a recorded id is kept: the wires accept it.
    expect(ids(hazards[8] as Message)).toEqual(['call-1']);
    const reserved = new HistoryCompiler({ fallback: (n) => `c${n}` }).calls({
      role: 'assistant',
      content: '',
      tool_calls: [
        { label: 'a', output: 1 },
        { id: 'c1', label: 'b', output: 2 },
      ],
    });
    expect(reserved.map((call) => call.id)).toEqual(['c1_2', 'c1']);
    const rekeyed = new HistoryCompiler({ fallback: (n) => `c${n}`, policy: 'rekey' });
    expect(rekeyed.calls(hazards[2] as Message).map((call) => call.id)).toEqual(['c1', 'c2']);
  });
});

describe('every wire receives the history as paired tool records', () => {
  for (const wire of Object.keys(WIRES)) {
    it(`${wire}: each result follows its own call, with an id no other call of its turn holds`, () => {
      expect(pairingProblems(wire, hazards)).toEqual([]);
    });
  }

  it('google: a recorded id that repeats one of the same turn is replaced; a call recorded with no id gets none', () => {
    const { contents } = toGoogleContents(hazards, new WireNames([], ANTHROPIC_NAME));
    const ids = contents.flatMap((content) =>
      (content.parts ?? []).flatMap((part) =>
        part.functionCall
          ? [part.functionCall.id ?? null]
          : part.functionResponse
            ? [part.functionResponse.id ?? null]
            : [],
      ),
    );
    // Turn 1: two calls recorded as call-1, then their two responses. Turn 2: a.b and a_b, distinct as
    // recorded on this wire, and a call with no id. Turn 3: call-1 again, kept across turns.
    expect(ids).toEqual([
      'call-1',
      'call_h1',
      'call-1',
      'call_h1',
      'a.b',
      'a_b',
      null,
      'a.b',
      'a_b',
      null,
      'call-1',
      'call-1',
    ]);
  });

  it('anthropic: a call recorded with no id takes the number of its place among every call, as before', () => {
    // The Anthropic wire numbers every call of the history, recorded id or not: toolu_h<n> for the n-th call.
    const mixed: Message[] = [
      { role: 'user', content: 'Check two addresses.' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'kept-1', label: 'coverage.check', output: { found: true } },
          { label: 'coverage.check', output: { found: false } },
        ],
      },
      { role: 'user', content: 'And the plans?' },
      { role: 'assistant', content: '', tool_calls: [{ label: 'catalog.search', output: { plans: [] } }] },
    ];
    const { messages } = toAnthropicMessages(mixed, new WireNames([], ANTHROPIC_NAME));
    const ids = messages.flatMap((message) =>
      (message.content as { type: string; id?: string; tool_use_id?: string }[]).flatMap((block) =>
        block.type === 'tool_use' ? [block.id] : block.type === 'tool_result' ? [block.tool_use_id] : [],
      ),
    );
    expect(ids).toEqual(['kept-1', 'toolu_h2', 'kept-1', 'toolu_h2', 'toolu_h3', 'toolu_h3']);
  });

  it('chat: a free tool note goes as user text, never as a tool message that answers no call', () => {
    const notes = toChatMessages(hazards).filter(
      (message) => message.content === 'a free tool note, answering no call',
    );
    expect(notes.map((message) => message.role)).toEqual(['user']);
  });
});

/** Every history of the example specs: each block's own prefix and each block's mode T prefix. */
async function exampleHistories(): Promise<{ id: string; history: Message[] }[]> {
  const out: { id: string; history: Message[] }[] = [];
  const seen = new Set<string>();
  for (const file of await findSpecFiles([`${ROOT}examples`])) {
    const loaded = await loadSpecFile(file);
    if (!loaded.ok) continue;
    loaded.spec.blocks.forEach((block, index) => {
      for (const [kind, history] of [
        ['prefix', block.given?.prefix ?? []],
        ['T', canonicalGiven(loaded.spec, index).prefix],
      ] as const) {
        const key = JSON.stringify(history);
        if (history.length === 0 || seen.has(key)) continue;
        seen.add(key);
        out.push({ id: `${file.slice(ROOT.length)} block ${index} ${kind}`, history: [...history] });
      }
    });
  }
  return out;
}

describe('the example histories', () => {
  it('render as paired records on every wire, and read back unchanged from Anthropic, Responses and Chat', async () => {
    const histories = [...(await exampleHistories()), { id: 'hazards', history: hazards }];
    // The example corpus holds tool history: an empty corpus would pass vacuously.
    const calls = histories.reduce(
      (n, entry) => n + entry.history.reduce((k, message) => k + (message.tool_calls?.length ?? 0), 0),
      0,
    );
    expect(histories.length).toBeGreaterThan(100);
    expect(calls).toBeGreaterThan(500);
    const problems: string[] = [];
    for (const { id, history } of histories) {
      for (const wire of Object.keys(WIRES)) {
        for (const problem of pairingProblems(wire, history)) problems.push(`${wire} ${id}: ${problem}`);
      }
      const names = new WireNames([], ANTHROPIC_NAME);
      const anthropic = toAnthropicMessages(history, names);
      const back = fromAnthropic(anthropic).map((message) => ({
        ...message,
        ...(message.calls
          ? { calls: message.calls.map((call) => ({ ...call, label: names.label(call.label) })) }
          : {}),
      }));
      if (
        JSON.stringify({ messages: back, normalizations: anthropic.normalizations }) !==
        JSON.stringify(carried(history, { system: 'apart', omitEmptyText: 'anthropic' }))
      )
        problems.push(`anthropic ${id}: read back differs`);
      const system = history.filter((message) => message.role === 'system' && message.content !== '');
      if (JSON.stringify(anthropic.system) !== JSON.stringify(system.map((message) => message.content)))
        problems.push(`anthropic ${id}: system differs`);
      if (
        JSON.stringify(fromChat(toChatMessages(history))) !==
        JSON.stringify(carried(history, { system: 'inline', keepEmpty: true }).messages)
      )
        problems.push(`chat ${id}: read back differs`);
      const items = toInputItems(history, new ToolLabels());
      if (
        JSON.stringify(fromResponses(items)) !==
        JSON.stringify(carried(history, { system: 'inline', mergeCallTurns: true }).messages)
      )
        problems.push(`responses ${id}: read back differs`);
    }
    expect(problems.slice(0, 20)).toEqual([]);
  }, 300_000);
});
