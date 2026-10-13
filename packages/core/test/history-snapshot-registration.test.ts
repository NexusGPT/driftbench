import { describe, expect, it } from 'vitest';
import { immutableHistorySource, lazyHistoryCopy } from '../src/contracts/history';
import type { Message } from '../src/schema/common';

function source(count: number) {
  return immutableHistorySource(
    Array.from(
      { length: count },
      (_, index): Message => ({
        role: 'assistant',
        content: String(index),
        tool_calls: [{ label: 'lookup', input: { index } }],
      }),
    ),
  );
}

describe('immutable message snapshot metadata', () => {
  it('does not register old message sources again for each snapshot', () => {
    const history = source(400);
    const set = WeakMap.prototype.set;
    let registrations = 0;
    WeakMap.prototype.set = function (key: object, value: unknown) {
      if ((key as Message).role && (value as Message | undefined)?.role) registrations += 1;
      return set.call(this, key, value);
    };
    let copy: Message[];
    try {
      copy = lazyHistoryCopy(history);
    } finally {
      WeakMap.prototype.set = set;
    }
    expect(registrations).toBe(0);
    expect(copy).toHaveLength(400);
    expect(structuredClone(copy)).toEqual(history);
  });

  it('gives every snapshot its own nested fields and retains sealed reads', () => {
    const history = source(1);
    const first = lazyHistoryCopy(history);
    const second = lazyHistoryCopy(history);
    const message = first[0];
    if (!message) throw new Error('missing message');
    Object.seal(message);
    const input = message.tool_calls?.[0]?.input as { index: number };
    input.index = 99;
    expect(second[0]?.tool_calls?.[0]?.input).toEqual({ index: 0 });
    expect(history[0]?.tool_calls?.[0]?.input).toEqual({ index: 0 });
    expect(structuredClone(first)[0]?.tool_calls?.[0]?.input).toEqual({ index: 99 });
  });
});
