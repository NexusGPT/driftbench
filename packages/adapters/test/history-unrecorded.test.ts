import { readFileSync } from 'node:fs';
import {
  canonicalGiven,
  contentHash,
  type Message,
  runSpec,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { ToolLabels, UNRECORDED_RESULT, WireNames } from '../src/anthropic/common';
import { ANTHROPIC_ADAPTER_VERSION, anthropicAdapter } from '../src/anthropic/index';
import { ANTHROPIC_NAME, toAnthropicMessages } from '../src/anthropic/messages';
import { GOOGLE_NAME, toGoogleContents } from '../src/google/contents';
import { GOOGLE_ADAPTER_VERSION } from '../src/google/index';
import { toChatMessages } from '../src/http/chat';
import { HTTP_ADAPTER_VERSION } from '../src/http/index';
import { LANGGRAPH_ADAPTER_VERSION } from '../src/langgraph/index';
import { toLangChainMessages } from '../src/langgraph/messages';
import { LITELLM_ADAPTER_VERSION } from '../src/litellm/index';
import { OPENAI_AGENTS_ADAPTER_VERSION } from '../src/openai-agents/index';
import { toInputItems } from '../src/openai-agents/items';
import { PYDANTIC_AI_ADAPTER_VERSION, toPydanticMessages } from '../src/pydantic-ai/index';
import { toModelMessages, VERCEL_AI_ADAPTER_VERSION } from '../src/vercel-ai/index';
import { recordedAnthropic } from './fixtures/sdk/anthropic';

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

/** The version every adapter below had before a past call without a result became the note. */
const PRE_NOTE_VERSION = '0.1.0';

describe('the adapters whose wire output the note changes', () => {
  it('each carry a new version, so no cache entry made before the note replays', () => {
    for (const version of [
      ANTHROPIC_ADAPTER_VERSION,
      GOOGLE_ADAPTER_VERSION,
      HTTP_ADAPTER_VERSION,
      LITELLM_ADAPTER_VERSION,
      LANGGRAPH_ADAPTER_VERSION,
      OPENAI_AGENTS_ADAPTER_VERSION,
      PYDANTIC_AI_ADAPTER_VERSION,
      VERCEL_AI_ADAPTER_VERSION,
    ]) {
      expect(version).not.toBe(PRE_NOTE_VERSION);
    }
  });

  it('give a mode T block with an unrecorded call a new cache key', async () => {
    const answer = {
      id: 'msg_0',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Let me check.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const keyOfBlock1 = async (version?: string) => {
      const adapter = anthropicAdapter({
        client: recordedAnthropic([answer, answer]),
        model: 'claude-fake-acme',
        deterministic: true,
        ...(version === undefined ? {} : { version }),
      });
      const run = await runSpec(parsed.spec, {
        adapter,
        driver: createScriptedDriver(),
        checks: [],
        mode: 'T',
        repeat: 0,
      });
      expect(run.status, run.error).toBe('completed');
      return run.blocks[1]?.cacheKey;
    };
    // The version string the adapter had before: the same configuration hash after the old version.
    const before = `${PRE_NOTE_VERSION}+${contentHash({ model: 'claude-fake-acme', system: null })}`;
    const [old, now] = [await keyOfBlock1(before), await keyOfBlock1()];
    expect(old).toMatch(/^block:/);
    expect(now).toMatch(/^block:/);
    expect(now).not.toBe(old);
  });
});
