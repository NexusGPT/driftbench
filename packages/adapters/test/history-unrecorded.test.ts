import { readFileSync } from 'node:fs';
import { canonicalGiven, type Message, validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { ToolLabels, UNRECORDED_RESULT, WireNames } from '../src/anthropic/common';
import { ANTHROPIC_NAME, toAnthropicMessages } from '../src/anthropic/messages';
import { GOOGLE_NAME, toGoogleContents } from '../src/google/contents';
import { toChatMessages } from '../src/http/chat';
import { toLangChainMessages } from '../src/langgraph/messages';
import { toInputItems } from '../src/openai-agents/items';
import { toPydanticMessages } from '../src/pydantic-ai/index';
import { toModelMessages } from '../src/vercel-ai/index';

/**
 * A teacher-forced prefix holds every call an earlier block expects, with a result only when the spec's
 * world forces one. Each history format must say a call's result was not recorded, never send it as null.
 */
const parsed = validateSpec({
  id: 'unrecorded',
  version: '1',
  given: { world: { tools: { 'catalog.search': { result: { plans: [] } } } } },
  blocks: [
    {
      user: 'Is there fiber at 3 Orchard Way?',
      expect: {
        tools: [
          { label: 'coverage.check', input: { address: { regex: '^3 Orchard' } } },
          { label: 'catalog.search', input: { category: 'home' } },
        ],
      },
    },
    { user: 'And the price?' },
  ],
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed));
const prefix = canonicalGiven(parsed.spec, 1).prefix;

/** A history with a recorded null output: what an agent's own run records for a tool that returned nothing. */
const recordedNull: Message[] = [
  { role: 'user', content: 'q' },
  {
    role: 'assistant',
    content: '',
    tool_calls: [{ id: 'c1', label: 'coverage.check', input: {}, output: null }],
  },
];

const labels = new ToolLabels({ coverage_check: 'coverage.check', catalog_search: 'catalog.search' });
const formats: Record<string, (history: readonly Message[]) => unknown> = {
  anthropic: (history) => toAnthropicMessages(history, new WireNames([], ANTHROPIC_NAME)).messages,
  google: (history) => toGoogleContents(history, new WireNames([], GOOGLE_NAME)).contents,
  'http chat and litellm': (history) => toChatMessages(history),
  langgraph: (history) => toLangChainMessages(history, labels),
  'openai-agents': (history) => toInputItems(history, labels),
  'pydantic-ai': (history) => toPydanticMessages(history, labels),
  'vercel-ai': (history) => toModelMessages(history, labels),
};

describe('a history call with no recorded result', () => {
  it('is in the canonical prefix with neither output nor error', () => {
    const calls = prefix.flatMap((message) => message.tool_calls ?? []);
    expect(calls).toEqual([
      { label: 'coverage.check', input: {} },
      { label: 'catalog.search', input: { category: 'home' }, output: { plans: [] } },
    ]);
  });

  for (const [name, format] of Object.entries(formats)) {
    it(`${name}: is sent with the unrecorded note, never as null`, () => {
      const wire = JSON.stringify(format(prefix));
      expect(wire).toContain(JSON.stringify(UNRECORDED_RESULT).slice(1, -1));
      // The forced result of the other call still goes out as it is.
      expect(wire).toContain('plans');
      expect(wire.split(JSON.stringify(UNRECORDED_RESULT).slice(1, -1)).length - 1).toBe(1);
    });

    it(`${name}: a recorded null output is sent as before`, () => {
      const wire = JSON.stringify(format(recordedNull));
      expect(wire).not.toContain(JSON.stringify(UNRECORDED_RESULT).slice(1, -1));
      expect(wire).toContain('null');
    });
  }

  it('is the text the mode T docs quote', () => {
    const docs = readFileSync(new URL('../../../docs/concepts/run-modes.md', import.meta.url), 'utf8');
    expect(docs).toContain(UNRECORDED_RESULT);
  });
});
