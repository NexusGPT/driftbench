import { describe, expect, it } from 'vitest';
import { countMessageVisits } from '../../src/ladders/system/bank/growth';

type Message = { role: string; content: string };

function history(length: number): Message[] {
  return Array.from({ length }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index}`,
  }));
}

async function visitsOf(work: (messages: Message[]) => unknown, length = 6) {
  const messages = history(length);
  const { count } = await countMessageVisits(async () => work(messages));
  return count;
}

describe('the message meter', () => {
  it('counts one visit for every call of an array callback on a message', async () => {
    expect((await visitsOf((messages) => messages.filter((message) => message.role === 'user'))).by).toEqual({
      'Array.filter': 6,
    });
    expect((await visitsOf((messages) => messages.map((message) => message.content))).visits).toBe(6);
    // `find` stops at the first match: one callback, one visit.
    expect((await visitsOf((messages) => messages.find((message) => message.role === 'user'))).visits).toBe(
      1,
    );
    expect((await visitsOf((messages) => messages.reduce((total) => total + 1, 0))).visits).toBe(6);
  });

  it('counts every message a clone or a serialisation reaches', async () => {
    expect((await visitsOf((messages) => structuredClone(messages))).by).toEqual({ structuredClone: 6 });
    expect((await visitsOf((messages) => structuredClone({ turn: 1, messages }))).visits).toBe(6);
    expect((await visitsOf((messages) => JSON.stringify(messages))).by).toEqual({ 'JSON.stringify': 6 });
    expect((await visitsOf((messages) => JSON.stringify(messages[0]))).visits).toBe(1);
    expect((await visitsOf((messages) => messages.join(','))).by).toEqual({ 'Array.join': 6 });
  });

  it('counts a lookup or a registration keyed by a message', async () => {
    const count = await visitsOf((messages) => {
      const seen = new WeakMap<object, number>();
      const known = new Set<object>();
      for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index] as Message;
        if (!seen.has(message)) seen.set(message, index);
        known.add(message);
      }
    });
    expect(count.by).toEqual({ 'WeakMap.has': 6, 'WeakMap.set': 6, 'Set.add': 6 });
    expect(count.visits).toBe(18);
  });

  it('counts reflection on a message', async () => {
    const count = await visitsOf((messages) => {
      for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index] as Message;
        Object.keys(message);
        Object.freeze(message);
        Array.isArray(message);
      }
    });
    expect(count.by).toEqual({ 'Object.keys': 6, 'Object.freeze': 6, 'Array.isArray': 6 });
  });

  it('does not count a pass that moves pointers only', async () => {
    const count = await visitsOf((messages) => {
      const copies = [messages.slice(), [...messages], messages.concat([]), Array.from(messages)];
      let read = 0;
      for (const message of messages) if (message.role === 'user') read += 1;
      copies.push(messages);
      return read + messages.indexOf(messages[3] as Message);
    });
    expect(count).toEqual({ visits: 0, by: {}, sites: {} });
  });

  it('does not count what is not a message', async () => {
    const count = await visitsOf(() => {
      const numbers = [1, 2, 3].map((value) => value * 2).filter((value) => value > 2);
      const staff = [{ role: 'admin', name: 'Ada' }].map((person) => Object.keys(person));
      const calls = [{ id: 'call-1', label: 'orders.lookup' }].filter((call) => call.id);
      return [numbers, staff, calls, JSON.stringify({ a: 1 }), new Map([['key', 1]]).get('key')];
    });
    expect(count.visits).toBe(0);
  });

  it('says where the visits came from', async () => {
    function scanTheLedger(messages: Message[]) {
      for (let turn = 0; turn < 200; turn += 1) messages.filter((message) => message.role === 'assistant');
    }
    const count = await visitsOf(scanTheLedger);
    expect(count.visits).toBe(1200);
    expect(Object.keys(count.sites).join(' ')).toContain('scanTheLedger');
    expect(Object.values(count.sites).reduce((total, visits) => total + visits, 0)).toBe(998);
  });

  it('puts every built-in back, also when the work throws', async () => {
    const before = [
      Array.prototype.filter,
      Array.prototype.map,
      Array.isArray,
      Object.keys,
      Object.freeze,
      JSON.stringify,
      globalThis.structuredClone,
      WeakMap.prototype.get,
      WeakMap.prototype.set,
      Map.prototype.get,
      Set.prototype.add,
      Reflect.ownKeys,
    ];
    const after = () => [
      Array.prototype.filter,
      Array.prototype.map,
      Array.isArray,
      Object.keys,
      Object.freeze,
      JSON.stringify,
      globalThis.structuredClone,
      WeakMap.prototype.get,
      WeakMap.prototype.set,
      Map.prototype.get,
      Set.prototype.add,
      Reflect.ownKeys,
    ];
    await countMessageVisits(async () => {
      expect(Array.prototype.filter).not.toBe(before[0]);
    });
    expect(after()).toEqual(before);
    await expect(
      countMessageVisits(async () => {
        throw new Error('the run failed');
      }),
    ).rejects.toThrow('the run failed');
    expect(after()).toEqual(before);
    for (const [index, builtin] of after().entries()) expect(builtin).toBe(before[index]);
  });

  it('refuses a second meter inside the first', async () => {
    await expect(countMessageVisits(() => countMessageVisits(async () => 1))).rejects.toThrow(
      'the message meter is already running',
    );
    // The refusal leaves the meter usable.
    expect((await visitsOf((messages) => messages.map((message) => message))).visits).toBe(6);
  });

  it('gives the work its own results: the wrapped built-ins behave as before', async () => {
    const messages = history(4);
    const { value } = await countMessageVisits(async () => ({
      users: messages.filter((message) => message.role === 'user').length,
      text: messages.map((message) => message.content).join('|'),
      clone: structuredClone(messages),
      json: JSON.stringify(messages[1]),
      keys: Object.keys(messages[0] as Message),
      found: messages.findLast((message) => message.role === 'user')?.content,
    }));
    expect(value).toEqual({
      users: 2,
      text: 'message 0|message 1|message 2|message 3',
      clone: messages,
      json: '{"role":"assistant","content":"message 1"}',
      keys: ['role', 'content'],
      found: 'message 2',
    });
  });
});
