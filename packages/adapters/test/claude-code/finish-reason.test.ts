import { describe, expect, it } from 'vitest';
import { mapSession, parseJsonl } from '../../src/claude-code';

/** A fictional headless-run transcript with two turns; each assistant record carries its stop reason. */
function transcript(stops: { first: string | undefined; second: string | undefined }) {
  const at = (s: number) => new Date(Date.UTC(2026, 0, 2, 9, 0, s)).toISOString();
  const assistant = (id: string, text: string, stop: string | undefined, s: number) => ({
    type: 'assistant',
    timestamp: at(s),
    message: {
      id,
      role: 'assistant',
      content: [{ type: 'text', text }],
      ...(stop === undefined ? {} : { stop_reason: stop }),
    },
  });
  const records = [
    { type: 'user', timestamp: at(1), message: { role: 'user', content: 'first ask' } },
    assistant('m1', 'one', stops.first, 2),
    { type: 'user', timestamp: at(3), message: { role: 'user', content: 'second ask' } },
    assistant('m2', 'two', stops.second, 5),
  ];
  return mapSession({ transcript: parseJsonl(records.map((record) => JSON.stringify(record)).join('\n')) });
}

describe('finish reason from the transcript', () => {
  it('reads the stop reason of each block from its assistant record', () => {
    const session = transcript({ first: 'end_turn', second: 'max_tokens' });
    expect(session.blocks.map((block) => block.observed.runtime?.finishReason)).toEqual([
      'end_turn',
      'max_tokens',
    ]);
  });

  it('leaves the finish reason out when the record carries none', () => {
    const session = transcript({ first: undefined, second: undefined });
    expect(session.blocks.map((block) => block.observed.runtime?.finishReason)).toEqual([
      undefined,
      undefined,
    ]);
  });
});
