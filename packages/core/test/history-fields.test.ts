import { afterEach, describe, expect, it, vi } from 'vitest';
import { immutableHistorySource, lazyHistoryCopy } from '../src/contracts/history';
import type { Message } from '../src/schema/common';

afterEach(() => vi.restoreAllMocks());

describe('plain history snapshot fields', () => {
  it('keeps ordinary message slots as data properties', () => {
    const source = immutableHistorySource(
      Array.from({ length: 400 }, (_, index): Message => ({ role: 'user', content: String(index) })),
    );
    const define = vi.spyOn(Object, 'defineProperty');
    const copy = lazyHistoryCopy(source);
    const slots = define.mock.calls.filter(
      ([target, key, descriptor]) => Array.isArray(target) && typeof key === 'number' && descriptor.get,
    );
    expect(slots).toHaveLength(0);
    expect(copy.at(-1)?.content).toBe('399');
    expect(structuredClone(copy)).toEqual(source);
    const first = copy[0];
    if (!first) throw new Error('missing first message');
    first.content = 'private';
    expect(source[0]?.content).toBe('0');
  });

  it('does not read a content accessor merely to read the role', () => {
    let reads = 0;
    const source: Message[] = [
      {
        role: 'user',
        get content() {
          reads += 1;
          return 'first';
        },
      },
    ];
    const copy = lazyHistoryCopy(source);
    expect(copy[0]?.role).toBe('user');
    expect(reads).toBe(0);
    expect(copy[0]?.content).toBe('first');
    expect(copy[0]?.content).toBe('first');
    expect(reads).toBe(1);
  });

  it('isolates nested fields through frozen and sealed message objects', () => {
    const source = immutableHistorySource([
      { role: 'user', content: 'first', tool_calls: [{ label: 'lookup', input: { values: ['old'] } }] },
    ] satisfies Message[]);
    for (const seal of [Object.freeze, Object.seal]) {
      const copy = lazyHistoryCopy(source);
      const message = copy[0];
      if (!message) throw new Error('missing first message');
      seal(message);
      const input = message.tool_calls?.[0]?.input as { values: string[] };
      input.values.push('private');
      expect(structuredClone(copy)[0]?.tool_calls?.[0]?.input).toEqual({ values: ['old', 'private'] });
      expect(source[0]?.tool_calls?.[0]?.input).toEqual({ values: ['old'] });
    }
  });

  it('refreshes unmarked mutable inputs on each snapshot', () => {
    const message: Message = { role: 'user', content: 'first' };
    const source = [message];
    expect(lazyHistoryCopy(source)[0]?.content).toBe('first');
    message.content = 'second';
    expect(lazyHistoryCopy(source)[0]?.content).toBe('second');
  });

  it('keeps proxy message bodies unread until access', () => {
    let reads = 0;
    const message = new Proxy<Message>(
      { role: 'user', content: 'proxy' },
      {
        get(target, key, receiver) {
          if (key === 'content') reads += 1;
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const copy = lazyHistoryCopy([message]);
    expect(reads).toBe(0);
    expect(copy[0]?.content).toBe('proxy');
    expect(reads).toBe(1);
    expect(structuredClone(copy)).toEqual([{ role: 'user', content: 'proxy' }]);
  });

  it('retains the existing sparse-history snapshot shape', () => {
    const source = new Array<Message>(3);
    source[0] = { role: 'user', content: 'first' };
    source[2] = { role: 'assistant', content: 'last' };
    const copy = lazyHistoryCopy(source);
    expect(Object.keys(copy)).toEqual(['0', '1', '2']);
    expect(structuredClone(copy)).toEqual([source[0], undefined, source[2]]);
  });
});
