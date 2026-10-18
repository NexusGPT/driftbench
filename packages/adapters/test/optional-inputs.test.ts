import { describe, expect, it } from 'vitest';
import { newUsage, ToolLabels } from '../src/anthropic/common';
import { mapMessages } from '../src/langgraph/messages';
import { observedFromCandidate, readCandidate } from '../src/nexus/turn';
import { mapItems } from '../src/openai-agents/items';
import { parseArguments, toolCallsOf } from '../src/shared';

describe('input observation keeps the closed-input assertion meaningful', () => {
  it('keeps extra keys and non-object JSON arguments instead of normalizing them to an empty object', () => {
    expect(parseArguments('{"kind":"green","extra":true}')).toEqual({ kind: 'green', extra: true });
    for (const input of [null, [], 'broken JSON', '', '  ', 7]) expect(parseArguments(input)).toEqual(input);
    expect(parseArguments(undefined)).toBeNull();
    expect(parseArguments('null')).toBeNull();
    expect(parseArguments('[]')).toEqual([]);
    expect(parseArguments('{}')).toEqual({});
  });

  it('preserves raw candidate input from Nexus, including unreported inputs', () => {
    for (const input of [{ kind: 'green', extra: true }, null, undefined, []]) {
      const candidate = readCandidate(
        { content: 'Done.', toolCalls: [{ name: 'lookup', input }] },
        'fixture',
      );
      const observed = observedFromCandidate(candidate, 0, undefined);
      expect(observed.toolCalls[0]?.input).toEqual(input ?? null);
    }
  });

  it('keeps JSON argument keys from OpenAI Agents call items', () => {
    const { segments } = mapItems(
      [
        {
          type: 'tool_call_item',
          rawItem: {
            type: 'function_call',
            callId: 'call-1',
            name: 'lookup',
            arguments: '{"kind":"green","extra":true}',
          },
        },
      ],
      new ToolLabels(),
    );
    expect(toolCallsOf(segments)[0]?.input).toEqual({ kind: 'green', extra: true });
  });

  it('keeps the full LangGraph input object and a malformed null input', () => {
    for (const input of [{ kind: 'green', extra: true }, null]) {
      const segments = mapMessages(
        [{ type: 'ai', content: '', tool_calls: [{ id: 'call-1', name: 'lookup', args: input }] }],
        newUsage(),
        new ToolLabels(),
      );
      expect(toolCallsOf(segments)[0]?.input).toEqual(input);
    }
  });
});
