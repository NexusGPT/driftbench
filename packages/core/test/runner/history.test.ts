import { describe, expect, it, vi } from 'vitest';
import { copyHistory, freezeHistory, freezeMessage } from '../../src/contracts/history';
import type { Message } from '../../src/schema/common';

describe('history messages', () => {
  it.each([false, true])('rejects accessor content without invoking it, shallow frozen: %s', (shallow) => {
    const get = vi.fn(() => 'original');
    const message = Object.defineProperty({ role: 'user' }, 'content', {
      enumerable: true,
      get,
      set: vi.fn(),
    }) as Message;
    if (shallow) Object.freeze(message);
    expect(() => freezeMessage(message)).toThrow(/message.*content.*accessor/);
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects an accessor nested in a content part without invoking it', () => {
    const get = vi.fn(() => 'original');
    const part = Object.defineProperty({}, 'text', { get, enumerable: true });
    const message = { role: 'user', content: [part] } as unknown as Message;
    expect(() => freezeMessage(message)).toThrow(/message.*content.*0.*text.*accessor/);
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    [
      'class instance',
      () =>
        new (class Part {
          text = 'original';
        })(),
    ],
    ['Date', () => new Date('2026-01-01T00:00:00Z')],
    ['Map', () => new Map([['key', 'value']])],
    ['Set', () => new Set(['value'])],
    ['typed array', () => new Uint8Array([1])],
    ['function', () => () => 'value'],
    ['undefined', () => undefined],
    ['NaN', () => Number.NaN],
    ['Infinity', () => Number.POSITIVE_INFINITY],
    ['bigint', () => 1n],
    ['symbol', () => Symbol('value')],
  ])('rejects %s with the nested path', (_name, make) => {
    const message = {
      role: 'assistant',
      content: '',
      tool_calls: [{ label: 'lookup', input: { value: make() } }],
    } as unknown as Message;
    expect(() => freezeMessage(message)).toThrow(/message.*tool_calls.*0.*input.*value.*plain JSON/);
  });

  it('rejects a class instance used as the message itself', () => {
    class Entry {
      role = 'user' as const;
      content = 'original';
    }
    expect(() => freezeMessage(new Entry())).toThrow(/message.*plain JSON/);
  });

  it('rejects a private-field accessor class and accessor shape behind a Proxy', () => {
    class Entry {
      role = 'user' as const;
      #text = 'before';
      get content() {
        return this.#text;
      }
      set content(value: string) {
        this.#text = value;
      }
    }
    expect(() => freezeMessage(new Entry())).toThrow(/message.*non-plain prototype/);
    let text = 'before';
    const proxy = new Proxy(
      {
        role: 'user' as const,
        get content() {
          return text;
        },
        set content(value: string) {
          text = value;
        },
      },
      {},
    );
    // The accessor shape is reported first; a Proxy with plain data is rejected by the test below.
    expect(() => freezeMessage(proxy)).toThrow(/content.*accessor/);
    expect(text).toBe('before');
  });

  it('rejects a Proxy message whose get trap answers an absent optional field', () => {
    const call = { label: 'a', input: { q: 'before' } };
    const live = [call];
    const get = vi.fn((target: object, key: string | symbol, receiver: unknown) =>
      key === 'tool_calls' ? live : Reflect.get(target, key, receiver),
    );
    const proxy = new Proxy({ role: 'assistant', content: 'x' }, { get }) as Message;
    expect(() => copyHistory([proxy])).toThrow(TypeError);
    expect(() => freezeMessage(proxy)).toThrow(/^message: Proxy object; expected plain JSON data$/);
    expect(get).not.toHaveBeenCalled();
    call.input.q = 'caller-change';
    expect(Object.isFrozen(live)).toBe(false);
  });

  it.each([
    ['metadata', { metadata: new Proxy({ tag: 'x' }, {}) }, /message\["metadata"\]: Proxy object/],
    [
      'tool input',
      { tool_calls: [{ label: 'a', input: new Proxy({ q: 'x' }, {}) }] },
      /message\["tool_calls"\]\["0"\]\["input"\]: Proxy object/,
    ],
    [
      'tool call array',
      { tool_calls: new Proxy([{ label: 'a' }], {}) },
      /message\["tool_calls"\]: Proxy object/,
    ],
  ])('rejects a nested Proxy value in %s', (_name, extra, pattern) => {
    const message = { role: 'assistant', content: 'x', ...extra } as unknown as Message;
    expect(() => freezeMessage(message)).toThrow(TypeError);
    expect(() => copyHistory([message])).toThrow(pattern);
    expect(Object.isFrozen(message)).toBe(false);
  });

  it('rejects a Proxy history array', () => {
    const history = new Proxy([{ role: 'user', content: 'x' } as Message], {});
    expect(() => copyHistory(history)).toThrow(/^history: Proxy object; expected plain JSON data$/);
    expect(() => copyHistory([], history)).toThrow(/^appended: Proxy object/);
  });

  it('accepts null-prototype data and freezes its nested values', () => {
    const input = Object.assign(Object.create(null), { values: [null, true, 2, 'text'] });
    const message = Object.assign(Object.create(null), {
      role: 'assistant',
      content: '',
      tool_calls: [{ label: 'lookup', input }],
    }) as Message;
    expect(freezeMessage(message)).toBe(message);
    expect(Object.getPrototypeOf(message)).toBe(null);
    expect(() => {
      input.values.push('changed');
    }).toThrow(TypeError);
  });

  it('rejects cycles, sparse arrays and properties JSON cannot represent', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
    const sparse = new Array(2);
    sparse[1] = 'two';
    for (const value of [cycle, sparse, hidden, { [Symbol('key')]: 1 }]) {
      const message = { role: 'user', content: '', metadata: value } as unknown as Message;
      expect(() => freezeMessage(message)).toThrow(/message.*metadata.*plain JSON/);
    }
  });

  it('freezes nested content parts, tool calls and metadata, including a shallow-frozen parent', () => {
    const part = { type: 'text', text: 'original' };
    const parts = [part];
    const metadata = { tags: ['original'] };
    const call = { label: 'lookup', input: { query: ['original'] }, output: { rows: [1] } };
    const calls = [call];
    // The current schema uses string content; freezing also covers nested values without field whitelists.
    const message = Object.freeze({ role: 'assistant', content: parts, tool_calls: calls, metadata });
    expect(freezeMessage(message as unknown as Message)).toBe(message);
    expect(() => {
      part.text = 'changed';
    }).toThrow(TypeError);
    expect(() => {
      metadata.tags.push('changed');
    }).toThrow(TypeError);
    expect(() => {
      call.input.query[0] = 'changed';
    }).toThrow(TypeError);
    expect(() => {
      call.output.rows[0] = 2;
    }).toThrow(TypeError);
    expect(() => {
      calls.pop();
    }).toThrow(TypeError);
  });

  it('freezes each object once even when nested values share a reference', () => {
    const shared = { value: 'original' };
    const message: Message = {
      role: 'assistant',
      content: '',
      tool_calls: [{ label: 'lookup', input: shared, output: shared }],
    };
    const freeze = vi.spyOn(Object, 'freeze');
    try {
      freezeMessage(message);
      expect(freeze.mock.calls.filter(([value]) => value === shared)).toHaveLength(1);
      expect(freeze.mock.calls.filter(([value]) => value === message)).toHaveLength(1);
    } finally {
      freeze.mockRestore();
    }
  });

  it('names the full path of a fault deep in a message, and only that path after a valid sibling', () => {
    const deep = {
      role: 'assistant',
      content: 'x',
      tool_calls: [{ label: 'Read', input: { a: [1, { b: () => 1 }] } }],
    } as unknown as Message;
    expect(() => freezeMessage(deep)).toThrow(
      /^message\["tool_calls"\]\["0"\]\["input"\]\["a"\]\["1"\]\["b"\]: unsupported function; expected plain JSON data$/,
    );
    const sibling = { role: 'user', content: 'x', metadata: { nested: { ok: [1, 2] }, after: Symbol('s') } };
    expect(() => freezeMessage(sibling as unknown as Message)).toThrow(
      /^message\["metadata"\]\["after"\]: unsupported symbol; expected plain JSON data$/,
    );
  });

  it('reads a Proxy as Object.getOwnPropertyDescriptors does: a key its trap describes as absent is skipped', () => {
    const ghost = new Proxy({}, { ownKeys: () => ['ghost'], getOwnPropertyDescriptor: () => undefined });
    const message = { role: 'user', content: 'x', metadata: ghost } as unknown as Message;
    expect(() => freezeMessage(message)).toThrow(
      /^message\["metadata"\]: Proxy object; expected plain JSON data$/,
    );
  });
});

describe('history array snapshots', () => {
  const message = (content: string): Message => ({ role: 'user', content });

  it.each([
    ['hole', () => new Array(1)],
    ['undefined', () => [undefined]],
    ['null', () => [null]],
    ['primitive', () => ['text']],
    [
      'hole after a valid prefix',
      () => {
        const source = [message('valid')];
        copyHistory(source);
        source.length = 2;
        return source;
      },
    ],
  ])('rejects %s before the reference shortcut', (_name, make) => {
    const source = make() as Message[];
    expect(() => copyHistory(source)).toThrow(/history\[\d+\].*message object/);
  });

  it('rejects a deleted cached entry and an explicit undefined replacement', () => {
    const source = [message('valid')];
    copyHistory(source);
    delete source[0];
    expect(() => copyHistory(source)).toThrow(/history\[0\].*message object/);
    source[0] = undefined as unknown as Message;
    expect(() => copyHistory(source)).toThrow(/history\[0\].*message object/);
  });

  it('rejects arrays as entries even after they were frozen as nested JSON', () => {
    const nested: unknown[] = [];
    freezeMessage({ role: 'user', content: '', metadata: nested } as unknown as Message);
    expect(() => copyHistory([nested] as unknown as Message[])).toThrow(/message object/);
  });

  it.each(['history', 'appended'] as const)(
    'rejects accessor entries in %s without invoking them',
    (where) => {
      const checked = message('checked');
      const delivered = message('delivered');
      let reads = 0;
      const source = Object.defineProperty([], '0', {
        enumerable: true,
        get: () => (++reads === 1 ? checked : delivered),
      }) as Message[];
      expect(() => (where === 'history' ? copyHistory(source) : copyHistory([], source))).toThrow(
        /0.*accessor/,
      );
      expect(reads).toBe(0);
    },
  );

  it.each(['history', 'appended'] as const)('rejects a custom iterator on %s without running it', (where) => {
    let iterations = 0;
    const source = [message('checked')];
    Object.defineProperty(source, Symbol.iterator, {
      value: function* () {
        iterations++;
        yield message('unfrozen substitute');
      },
    });
    expect(() => (where === 'history' ? copyHistory(source) : copyHistory([], source))).toThrow(
      /non-index property/,
    );
    expect(iterations).toBe(0);
  });

  it('rejects an array-like length getter without invoking it', () => {
    let reads = 0;
    const source = Object.create(Array.prototype, {
      0: { value: message('one'), enumerable: true },
      length: {
        get: () => {
          reads++;
          return 1;
        },
      },
    });
    // A real Array's length is non-configurable and cannot become an accessor.
    expect(() => Object.defineProperty([], 'length', { get: () => 1 })).toThrow(TypeError);
    expect(() => copyHistory(source)).toThrow(/history.*ordinary array/);
    expect(reads).toBe(0);
  });

  it.each([
    ['extra property', () => Object.assign([message('one')], { extra: true })],
    ['symbol property', () => Object.assign([message('one')], { [Symbol('extra')]: true })],
    ['array subclass', () => new (class extends Array<Message> {})(message('one'))],
  ])('rejects %s on a history array', (_name, make) => {
    expect(() => copyHistory(make())).toThrow(/history.*(?:property|ordinary array)/);
  });

  it('rejects nested array accessors without reading them', () => {
    let reads = 0;
    const nested = Object.defineProperty([], '0', {
      enumerable: true,
      get: () => {
        reads++;
        return 'part';
      },
    });
    expect(() =>
      freezeMessage({ role: 'user', content: '', metadata: nested } as unknown as Message),
    ).toThrow(/metadata.*0.*accessor/);
    expect(reads).toBe(0);
  });

  it('copies immutable internal history into a mutable private array', () => {
    const entry = message('one');
    const retained = freezeHistory([entry]);
    expect(copyHistory(retained, [message('appended')])).toHaveLength(2);
    const copy = copyHistory(retained);
    expect(copy).toHaveLength(1);
    expect(Object.isFrozen(retained)).toBe(true);
    expect(Object.isFrozen(copy)).toBe(false);
    expect(copy[0]).toBe(entry);
    copy.push(message('two'));
    expect(retained).toHaveLength(1);
    expect(() => {
      entry.content = 'changed';
    }).toThrow(TypeError);
  });

  it('does not trust an externally frozen array after its descriptors change', () => {
    const source = [message('one')];
    copyHistory(source);
    let reads = 0;
    Object.defineProperty(source, '0', {
      get: () => {
        reads++;
        return message('replacement');
      },
    });
    Object.freeze(source);
    expect(() => copyHistory(source)).toThrow(/0.*accessor/);
    expect(reads).toBe(0);
  });

  it('checks replacements in place without revisiting unchanged entries', () => {
    const source = [message('first'), message('second')];
    const first = copyHistory(source);
    source[0] = message('replacement');
    const second = copyHistory(source);
    expect(second[0]).toBe(source[0]);
    expect(Object.isFrozen(source[0])).toBe(true);
    expect(first[0]?.content).toBe('first');
    expect(second[1]).toBe(first[1]);
  });

  it('freezes a message appearing twice once, and accepts a new array of old references without field walks', () => {
    const entry = message('shared');
    const values = vi.spyOn(Object, 'values');
    const descriptors = vi.spyOn(Object, 'getOwnPropertyDescriptors');
    const freeze = vi.spyOn(Object, 'freeze');
    try {
      const first = copyHistory([entry, entry]);
      expect(freeze.mock.calls.filter(([value]) => value === entry)).toHaveLength(1);
      values.mockClear();
      descriptors.mockClear();
      freeze.mockClear();
      const second = copyHistory([entry, entry]);
      const descriptorCalls = descriptors.mock.calls.filter(([value]) => value === entry).length;
      expect(second).not.toBe(first);
      expect(second[0]).toBe(entry);
      expect(second[1]).toBe(entry);
      expect(values).not.toHaveBeenCalled();
      expect(descriptorCalls).toBe(0);
      expect(freeze).not.toHaveBeenCalled();
    } finally {
      values.mockRestore();
      descriptors.mockRestore();
      freeze.mockRestore();
    }
  });

  it('checks a source that shrinks then grows back, and never exposes its private snapshot', () => {
    const source = [message('one'), message('two')];
    const handed = copyHistory(source);
    handed[0] = message('callback replacement');
    source.length = 1;
    copyHistory(source);
    source.push(message('new second'));
    const after = copyHistory(source);
    expect(after.map((entry) => entry.content)).toEqual(['one', 'new second']);
    expect(Object.isFrozen(after[1])).toBe(true);
    expect(Object.isFrozen(handed[0])).toBe(false);
  });

  it('keeps weak array keys when a message outlives its source array', () => {
    const entry = message('retained');
    const set = vi.spyOn(WeakMap.prototype, 'set');
    try {
      const source = [entry];
      const handed = copyHistory(source);
      expect(set.mock.calls.some(([key]) => key === source)).toBe(true);
      expect(set.mock.calls.some(([key]) => key === handed)).toBe(true);
      expect(set.mock.calls.some(([key]) => key === entry)).toBe(false);
    } finally {
      set.mockRestore();
    }
    expect(copyHistory([entry])[0]).toBe(entry);
  });
});
