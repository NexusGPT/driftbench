import type { ResolvedGiven } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { mapSession, parseJsonl, replayAdapter } from '../../src/claude-code';

const given: ResolvedGiven = {
  prefix: [],
  ledger: {},
  world: {},
  vars: {},
  target: { adapter: 'claude-code' },
  hash: 'replay-copy',
};

/** A session of one block whose Observed is `observed`, as written. */
function sessionOf(observed: unknown) {
  const session = mapSession({
    transcript: parseJsonl(
      [
        { type: 'user', message: { content: 'List the items.' } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'One item.' }] } },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n'),
    ),
  });
  (session.blocks[0] as { observed: unknown }).observed = observed;
  return session;
}

async function sent(observed: unknown): Promise<unknown> {
  const adapter = replayAdapter({ session: sessionOf(observed) });
  const session = await adapter.open(given);
  return adapter.send(session, { index: 0, given, stimulus: { user: 'List the items.' } });
}

/**
 * The shape of a value as a text: every own key with its enumerability, the kind of each object (array, plain,
 * null prototype, class name), primitives with -0 and bigint kept apart, and the references two places share.
 */
function shape(value: unknown): string {
  const ids = new Map<object, number>();
  const walk = (item: unknown): string => {
    if (item === null || typeof item !== 'object') {
      if (typeof item === 'number' && Object.is(item, -0)) return '-0';
      if (typeof item === 'bigint') return `${item}n`;
      return JSON.stringify(item) ?? String(item);
    }
    const seen = ids.get(item);
    if (seen !== undefined) return `#${seen}`;
    ids.set(item, ids.size);
    const prototype = Object.getPrototypeOf(item);
    const kind = Array.isArray(item)
      ? 'array'
      : prototype === null
        ? 'null'
        : prototype === Object.prototype
          ? 'plain'
          : (prototype?.constructor?.name ?? 'other');
    const keys = Reflect.ownKeys(item).map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(item, key) as PropertyDescriptor;
      return `${String(key)}${descriptor.enumerable ? '' : '!'}=${'value' in descriptor ? walk(descriptor.value) : 'get'}`;
    });
    return `${kind}${ids.get(item)}{${keys.join(',')}}`;
  };
  return walk(value);
}

/** What structuredClone gives for the value, or the error it throws. */
function expected(value: unknown): string {
  try {
    return shape(structuredClone(value));
  } catch (cause) {
    return `throws ${(cause as Error).name}`;
  }
}

async function actual(value: unknown): Promise<string> {
  try {
    return shape(await sent(value));
  } catch (cause) {
    return `throws ${(cause as Error).name}`;
  }
}

describe('a replayed block is a copy of the recorded one, as structuredClone makes it', () => {
  it('keeps holes, -0, undefined values, own __proto__ keys, shared and cyclic references', async () => {
    const shared = { path: 'a.ts' };
    const holes = [1, 2, 3];
    delete holes[1];
    const cycle: Record<string, unknown> = { name: 'loop' };
    cycle.self = cycle;
    const withExtra = Object.assign([1, 2], { extra: 'kept' });
    const withProto = JSON.parse('{"__proto__": {"x": 1}, "y": 2}');
    const bare = Object.assign(Object.create(null), { a: 1 });
    const observed = {
      text: 'One item.',
      toolCalls: [{ input: shared }, { input: shared }],
      holes,
      cycle,
      withExtra,
      withProto,
      bare,
      values: [-0, Number.NaN, undefined, null, 10n, ''],
    };
    expect(await actual(observed)).toBe(expected(observed));
  });

  it('copies a Date, a Map and a class instance, and refuses a function, as structuredClone does', async () => {
    class Item {
      a = 1;
    }
    for (const odd of [new Date(5), new Map([[1, 2]]), new Item(), new Uint8Array([1, 2])])
      expect(await actual({ text: 't', odd })).toBe(expected({ text: 't', odd }));
    expect(await actual({ text: 't', odd: () => 1 })).toBe('throws DataCloneError');
    expect(await actual({ text: 't', odd: new Proxy({}, {}) })).toBe(
      expected({ text: 't', odd: new Proxy({}, {}) }),
    );
  });

  it('agrees with structuredClone on generated values', async () => {
    let seed = 20261019;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
    const build = (depth: number, pool: object[]): unknown => {
      const roll = next();
      if (pool.length > 0 && roll < 0.08) return pick(pool);
      if (depth > 3 || roll < 0.4) return pick<unknown>([1, -0, 'a', true, null, Number.NaN, undefined, 3n]);
      if (roll < 0.42) return pick<unknown>([new Date(1), new Map(), new Set([1]), () => 1]);
      if (roll < 0.7) {
        const list: unknown[] = [];
        pool.push(list);
        for (let index = 0; index < Math.floor(next() * 4); index++) list.push(build(depth + 1, pool));
        if (next() < 0.1) delete list[0];
        return list;
      }
      const record: Record<string, unknown> = next() < 0.1 ? Object.create(null) : {};
      pool.push(record);
      for (let index = 0; index < Math.floor(next() * 4); index++)
        record[pick(['x', 'y', '1', '0', 'b'])] = build(depth + 1, pool);
      if (next() < 0.05) Object.defineProperty(record, 'hidden', { value: 1, enumerable: false });
      return record;
    };
    for (let round = 0; round < 2000; round++) {
      const observed = { text: 'One item.', value: build(0, []) };
      expect(await actual(observed), `round ${round}`).toBe(expected(observed));
    }
  });

  it('gives a copy each time: changing what was sent leaves the recording as it was', async () => {
    const recorded = { text: 'One item.', toolCalls: [{ label: 'Read', input: { path: 'a.ts' } }] };
    const adapter = replayAdapter({ session: sessionOf(recorded) });
    const session = await adapter.open(given);
    const turn = { index: 0, given, stimulus: { user: 'List the items.' } };
    const first = (await adapter.send(session, turn)) as unknown as typeof recorded;
    (first.toolCalls[0] as { input: { path: string } }).input.path = 'changed.ts';
    first.toolCalls.push({ label: 'Edit', input: { path: 'b.ts' } });
    expect(await adapter.send(session, turn)).toEqual(recorded);
    expect(recorded.toolCalls).toHaveLength(1);
  });
});
