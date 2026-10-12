import { describe, expect, it } from 'vitest';
import { copyOnWriteHistory, historyView, lazyHistoryCopy } from '../src/contracts/history';
import type { Message } from '../src/schema/common';

describe('history views', () => {
  it('pins the length while the owner appends and never visits unread messages', () => {
    let reads = 0;
    const original: Message[] = [
      {
        role: 'user',
        get content() {
          reads += 1;
          return 'first';
        },
      },
    ];
    const view = historyView(original);
    original.push({ role: 'user', content: 'later' });
    expect(view.length).toBe(1);
    expect(view[1]).toBeUndefined();
    expect(1 in view).toBe(false);
    expect(Object.keys(view)).toEqual(['0']);
    expect(reads).toBe(0);
    expect(view.at(-1)?.content).toBe('first');
    expect(reads).toBe(1);
  });

  it('isolates array and nested writes, including held references after reordering', () => {
    const original: Message[] = [
      { role: 'user', content: 'one', tool_calls: [{ label: 'lookup', input: { values: ['old'] } }] },
      { role: 'assistant', content: 'two' },
    ];
    const view = copyOnWriteHistory(original);
    const held = view[0] as Message;
    view.reverse();
    held.content = 'private';
    const input = held.tool_calls?.[0]?.input as { values: string[] };
    input.values.push('new');
    expect(view[1]?.content).toBe('private');
    expect(original[0]?.content).toBe('one');
    expect(original[0]?.tool_calls?.[0]?.input).toEqual({ values: ['old'] });
    expect(view.slice()).toHaveLength(2);
    expect(Array.isArray(view)).toBe(true);
  });

  it('enumerates and serializes like an array and isolates descriptor writes', () => {
    const original: Message[] = [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
    ];
    const view = copyOnWriteHistory(original);
    const described = Object.getOwnPropertyDescriptor(view, '0')?.value as Message;
    described.content = 'changed';
    Object.defineProperty(view, '0', { value: { role: 'user', content: 'replacement' }, configurable: true });
    delete view[1];
    expect(JSON.parse(JSON.stringify(view))).toEqual([{ role: 'user', content: 'replacement' }, null]);
    expect(original.map((message) => message.content)).toEqual(['one', 'two']);
  });
});

describe('legacy plain history arrays', () => {
  it('allows frozen-array reads, keeps nested copies isolated and rejects frozen slot writes', () => {
    const original: Message[] = [{ role: 'user', content: 'one' }];
    const copy = lazyHistoryCopy(original);
    Object.freeze(copy);
    const message = copy[0] as Message;
    expect(message.content).toBe('one');
    message.content = 'private';
    expect(copy[0]?.content).toBe('private');
    expect(original[0]?.content).toBe('one');
    expect(() => {
      copy[0] = { role: 'user', content: 'replacement' };
    }).toThrow(TypeError);
    expect(structuredClone(copy)).toEqual([{ role: 'user', content: 'private' }]);
  });

  it('allows sealed-array reads, reordering and replacement without exposing the source', () => {
    const original: Message[] = [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
    ];
    const copy = lazyHistoryCopy(original);
    Object.seal(copy);
    const held = copy[0] as Message;
    copy.reverse();
    held.content = 'private';
    expect(copy[1]?.content).toBe('private');
    copy[0] = { role: 'user', content: 'replacement' };
    expect(copy[0]?.content).toBe('replacement');
    expect(original.map((message) => message.content)).toEqual(['one', 'two']);
  });
});
