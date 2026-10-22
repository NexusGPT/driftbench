import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Frame, isolate } from '../../src/frame';
import { twinDriver } from '../../src/frame/driver';
import type * as aliasing from './fixtures/aliasing';
import { applyWrites, plainWrites, TARGETS, WRITES, writeTarget } from './fixtures/aliasing';

/**
 * Aliased results (docs/validators.md section 12.9). The frame hands the item each answer as data, so an item
 * that keeps the first result across the second call cannot see a package that fills one object again or
 * overwrites the earlier result. With `aliasing: true` each confined run keeps the live results of its last calls
 * and reports a call after which one of them changed; the frame reports it as `aliasSince`.
 */

vi.setConfig({ testTimeout: 300_000 });

const PRODUCT = fileURLToPath(new URL('./fixtures/aliasing.ts', import.meta.url));
type Product = typeof aliasing;

const open: Frame<unknown>[] = [];
afterEach(() => {
  for (const frame of open.splice(0)) frame.close();
});

/** The item: two calls, the first result read after the second. Returns whether it passes, and what the frame found. */
function twoCalls(name: 'fresh' | 'shared' | 'overwrite', aliasingOn: boolean, plain = false) {
  const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: aliasingOn, plain });
  open.push(frame as Frame<unknown>);
  const mark = frame.position();
  const a = frame.product[name]([1, 2, 3]);
  const b = frame.product[name]([10, 20, 30]);
  return { pass: a.total === 6 && b.total === 60, found: frame.aliasSince(mark) };
}

describe('aliased results under the frame', () => {
  it('finds nothing in a package that returns a new object on every call', () => {
    expect(twoCalls('fresh', true)).toEqual({ pass: true, found: undefined });
  });

  it.each(['shared', 'overwrite'] as const)(
    '%s: the item passes on the data, the frame finds the alias',
    (name) => {
      const run = twoCalls(name, true);
      expect(run.pass).toBe(true);
      expect(run.found).toContain('has changed since');
    },
  );

  it.each(['shared', 'overwrite'] as const)('%s: nothing is reported when the option is off', (name) => {
    expect(twoCalls(name, false).found).toBeUndefined();
  });

  it('reports a change once, at the call after which it is seen', () => {
    const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: true, plain: false });
    open.push(frame as Frame<unknown>);
    frame.product.overwrite([1]);
    frame.product.overwrite([2]);
    const later = frame.position();
    frame.product.fresh([3]);
    frame.product.fresh([4]);
    expect(frame.aliasSince(0)).toContain('has changed since');
    expect(frame.aliasSince(later)).toBeUndefined();
  });

  it.each(['proxied', 'holding'] as const)(
    '%s: a result that is or holds a Proxy is an invalid result',
    (name) => {
      const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: true, plain: false });
      open.push(frame as Frame<unknown>);
      frame.product[name]([1, 2, 3]);
      expect(frame.aliasSince(0)).toContain('Proxy');
    },
  );

  it.each(['withGetter', 'withSetter'] as const)(
    '%s: a result that holds an accessor property is an invalid result',
    (name) => {
      const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: true, plain: false });
      open.push(frame as Frame<unknown>);
      frame.product[name]([1, 2, 3]);
      expect(frame.aliasSince(0)).toContain('accessor');
    },
  );

  it('reports nothing for a Proxy result when the option is off', () => {
    const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: false, plain: false });
    open.push(frame as Frame<unknown>);
    frame.product.proxied([1, 2, 3]);
    expect(frame.aliasSince(0)).toBeUndefined();
  });

  it('finds a typed array refilled on every call whose own length property says 0', () => {
    const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: true, plain: false });
    open.push(frame as Frame<unknown>);
    frame.product.sharedTyped();
    frame.product.sharedTyped();
    expect(frame.aliasSince(0)).toContain('has changed since');
  });

  it.each(['mapWithAccessor', 'arrayWithAccessor'] as const)(
    '%s: an accessor in an extra property of a container makes the result invalid',
    (name) => {
      const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: true, plain: false });
      open.push(frame as Frame<unknown>);
      frame.product[name]();
      expect(frame.aliasSince(0)).toContain('accessor');
    },
  );

  it.each(['withArrayGetter', 'withArraySetter'] as const)(
    '%s: an array element that is an accessor makes the result invalid',
    (name) => {
      const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: true, plain: false });
      open.push(frame as Frame<unknown>);
      frame.product[name]();
      expect(frame.aliasSince(0)).toContain('accessor');
    },
  );
});

// A package that patches an intrinsic the digest could use, with a shared value that only that intrinsic reads: the
// driver captured them before the product loaded, so the change is still seen.
describe('aliased results when the package patches the iteration and time intrinsics', () => {
  const module = (name: string) =>
    fileURLToPath(new URL(`./fixtures/alias-patched/${name}.ts`, import.meta.url));
  it.each(['map', 'set', 'date'])('finds a shared %s refilled on every call', (name) => {
    const frame = isolate<{ next(): unknown }>({
      module: module(name),
      seed: 11,
      aliasing: true,
      plain: false,
    });
    open.push(frame as Frame<unknown>);
    frame.product.next();
    frame.product.next();
    expect(frame.aliasSince(0)).toContain('has changed since');
  });

  // The digest walk uses nothing the product can reach: no global is read by name and no method is called on a
  // value or a prototype. Every helper is a constant taken before the product loads and applied with Reflect.apply.
  it('walks with captured references only', () => {
    const source = twinDriver(1, 'source-check');
    const start = source.indexOf('// Aliased results');
    const end = source.indexOf('new Array(16)');
    expect(start).toBeGreaterThan(0);
    const body = source.slice(start, end);
    expect(
      body.match(
        /\b(Reflect|JSON|Object|Array|ArrayBuffer|Map|Set|WeakSet|Date|Number|String|Symbol|Math)\./g,
      ),
    ).toBeNull();
    expect(
      body.match(
        /\.(update|digest|next|getTime|entries|values|has|add|push|shift|slice|concat|join|map|forEach)\(/g,
      ),
    ).toBeNull();
    // no iteration protocol (for-of, spread): the array and Map iterators are patchable
    expect(body).not.toMatch(/for \((const|let|var) [^;)]*\bof\b/);
    expect(body).not.toMatch(/\[\.\.\.|\(\.\.\./);
  });
});

// An item that declares a purity check switches strict arguments on (docs/validators.md section 12.9, "Written
// inputs"): the arguments reach the product frozen at every depth, in every run, and a digest of them before and
// after each call reports a write the freeze cannot stop. Without it the frame adds no rule.
describe('written arguments', () => {
  const arg = { deep: { list: [1, 2, 3] } };
  const strictFrame = (on = true) => {
    const frame = isolate<Product>({ module: PRODUCT, seed: 11 });
    open.push(frame as Frame<unknown>);
    frame.strictArguments(on);
    return frame;
  };

  it('lets a product that only reads its argument answer, in every run', () => {
    const frame = strictFrame();
    expect(frame.product.readsOnly(arg)).toBe(3);
    expect(frame.divergence()).toBeUndefined();
    expect(frame.aliasSince(0)).toBeUndefined();
  });

  it('throws for a product that writes to a nested part of its argument and puts the value back', () => {
    expect(() => strictFrame().product.touchesAndRestores(arg)).toThrow(/read only|frozen|Cannot assign/i);
  });

  it('throws for a product that sorts its argument in place', () => {
    expect(() => strictFrame().product.sortsInPlace([1, 3, 2])).toThrow();
  });

  it.each([
    ['fillsTyped', { bytes: new Uint8Array(2) }],
    ['fillsMap', { table: new Map<string, number>() }],
  ] as const)('%s: a permanent write the freeze cannot stop is found by the digest', (name, input) => {
    const frame = strictFrame();
    (frame.product[name] as (x: unknown) => unknown)(input);
    expect(frame.aliasSince(0)).toContain('changed an argument');
  });

  it('adds no rule when strict arguments are off: the same products answer and nothing is found', () => {
    const frame = strictFrame(false);
    expect(frame.product.touchesAndRestores(arg)).toBe(3);
    expect(frame.product.sortsInPlace([1, 3, 2])).toBe(3);
    frame.product.fillsMap({ table: new Map() });
    expect(frame.aliasSince(0)).toBeUndefined();
    expect(frame.divergence()).toBeUndefined();
  });

  it('is switched off again by strictArguments(false)', () => {
    const frame = strictFrame();
    frame.strictArguments(false);
    expect(frame.product.sortsInPlace([1, 3, 2])).toBe(3);
  });
});

// The product's changes to its arguments come back (docs/validators.md section 12.9, "Written inputs"): an item that
// reads its own arguments after a call sees exactly what it would see if the product ran in its own process.
describe('arguments the product changed come back to the caller', () => {
  const open2 = (): Frame<Product> => {
    const frame = isolate<Product>({ module: PRODUCT, seed: 11, plain: false });
    open.push(frame as Frame<unknown>);
    return frame;
  };

  it('applies a sort in place, a fill, a length change and a deleted or added key at every depth', () => {
    const frame = open2();
    const list = [3, 1, 2];
    const sorted = [1, 3, 2];
    expect(frame.product.sortsInPlace(sorted)).toBe(3);
    expect(sorted).toEqual([3, 2, 1]);
    const input = { list, tail: [1, 2, 3], keyed: { gone: 1, kept: 2 } as Record<string, number> };
    const sameList = input.list;
    expect(frame.product.changesAfterwards(input)).toBe(6);
    expect(input.list).toBe(sameList);
    expect(input).toEqual({ list: [10000, 10000, 10000], tail: [1, 7], keyed: { kept: 2, added: 1 } });
  });

  it('applies a change to a Map, a Set, a typed array and a Date', () => {
    const frame = open2();
    const input = {
      table: new Map([['x', 1]]),
      bag: new Set([1]),
      bytes: new Uint8Array(3),
      when: new Date(0),
    };
    const table = input.table;
    frame.product.changesContainers(input);
    expect(input.table).toBe(table);
    expect([...input.table]).toEqual([['a', 5]]);
    expect([...input.bag]).toEqual([1, 9]);
    expect([...input.bytes]).toEqual([0, 8, 0]);
    expect(input.when.getTime()).toBe(1000);
  });

  it('leaves the arguments of a product that writes only to a copy byte for byte as they were', () => {
    const frame = open2();
    const input = { list: [3, 1, 2] };
    const before = JSON.stringify(input);
    frame.product.writesToACopy(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('does not touch an argument the caller froze', () => {
    const frame = open2();
    const input = Object.freeze({ list: Object.freeze([3, 1, 2]) });
    expect(frame.product.writesToACopy(input as never)).toBe(3);
    expect(input.list).toEqual([3, 1, 2]);
  });
});

// The class: random writes of every kind to random targets at random depths. What the frame can copy back must give
// the caller exactly what the same writes give in the caller's own process; what it cannot copy back (a function
// value, an accessor, a symbol or hidden key, an extra property of a container, the prototype, the extensibility)
// must be reported as "cannot reproduce", never passed silently.
describe('random writes to the arguments, at every depth', () => {
  const rng = (seed: number) => {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  };
  const names = Object.keys(TARGETS);
  const draw = (random: () => number) => {
    const length = 1 + Math.floor(random() * 3);
    return Array.from({ length }, () => {
      const target = names[Math.floor(random() * names.length)] as string;
      const kinds = WRITES[TARGETS[target]?.kind as string] as { name: string; copy: boolean }[];
      const kind = kinds[Math.floor(random() * kinds.length)] as { name: string; copy: boolean };
      return { write: { target, kind: kind.name }, copy: kind.copy };
    });
  };

  it('copies back what it can and reports the rest, over every kind alone and 150 random programs', () => {
    const random = rng(986);
    const frame = isolate<Product>({ module: PRODUCT, seed: 11, plain: false });
    open.push(frame as Frame<unknown>);
    let copied = 0;
    let reported = 0;
    // Every kind of write on every kind of target once, then the random programs.
    const single = Object.entries(TARGETS).flatMap(([target, each]) =>
      (WRITES[each.kind] as { name: string; copy: boolean }[]).map((kind) => [
        { write: { target, kind: kind.name }, copy: kind.copy },
      ]),
    );
    for (let trial = 0; trial < single.length + 150; trial += 1) {
      const drawn = trial < single.length ? (single[trial] as ReturnType<typeof draw>) : draw(random);
      const program = drawn.map((each) => each.write);
      const canCopy = drawn.every((each) => each.copy);
      const direct = writeTarget();
      let directThrew = false;
      try {
        applyWrites(direct, program);
      } catch {
        directThrew = true;
      }
      const input = writeTarget();
      const mark = frame.position();
      let threw = false;
      try {
        (frame.product.applyWrites as (a: unknown, b: unknown) => unknown)(input, program);
      } catch {
        threw = true;
      }
      const note = JSON.stringify(program);
      if (canCopy) {
        expect(threw, note).toBe(directThrew);
        expect(frame.aliasSince(mark), note).toBeUndefined();
        if (!directThrew) expect(isDeepStrictEqual(input, direct), note).toBe(true);
        copied += 1;
      } else {
        expect(threw || (frame.aliasSince(mark) ?? '').includes('cannot reproduce'), note).toBe(true);
        reported += 1;
      }
    }
    expect(copied).toBeGreaterThan(10);
    expect(reported).toBeGreaterThan(40);
  });
});

describe('results that differ only by function identity', () => {
  it('finds a function field replaced by another function between two calls', () => {
    const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: true, plain: false });
    open.push(frame as Frame<unknown>);
    frame.product.swapsFunction();
    frame.product.swapsFunction();
    expect(frame.aliasSince(0)).toContain('has changed since');
  });

  it('finds nothing for new objects that hold the same function', () => {
    const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: true, plain: false });
    open.push(frame as Frame<unknown>);
    frame.product.keepsFunction();
    frame.product.keepsFunction();
    expect(frame.aliasSince(0)).toBeUndefined();
  });
});

// Codex, run 39780074824: keys that shadow the names of Object.prototype are keys like any other, and the identity of
// the children of an argument (reached twice, or replaced by an equal copy) is part of the record.
describe('plain objects with shadowing keys and children', () => {
  const base = () =>
    Object.fromEntries([
      ['toString', 1],
      ['constructor', 2],
      ['hasOwnProperty', 3],
      ['a', 4],
      ['x', { v: 1 }],
      ['y', { v: 1 }],
    ]) as Record<string, any>;
  const run = (which: string) => {
    const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: true, plain: false });
    open.push(frame as Frame<unknown>);
    const input = base();
    (frame.product.plainWrites as (a: unknown, b: string) => unknown)(input, which);
    return { input, found: frame.aliasSince(0) };
  };
  const direct = (which: string) => {
    const input = base();
    plainWrites(input, which);
    return input;
  };

  it.each(['deleteToString', 'deleteConstructor', 'deleteHasOwnProperty', 'addConstructor', 'reorderKeys'])(
    '%s: the caller gets what the same write gives in its own process, keys in the same order',
    (which) => {
      const got = run(which);
      const want = direct(which);
      expect(got.found).toBeUndefined();
      expect(Object.keys(got.input)).toEqual(Object.keys(want));
      expect(isDeepStrictEqual(got.input, want)).toBe(true);
    },
  );

  it('addConstructor on an object that has no own key of that name gives the caller constructor = 7', () => {
    const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: true, plain: false });
    open.push(frame as Frame<unknown>);
    const input: Record<string, unknown> = { a: 4 };
    (frame.product.plainWrites as (a: unknown, b: string) => unknown)(input, 'addConstructor');
    expect(Object.hasOwn(input, 'constructor')).toBe(true);
    expect(input.constructor).toBe(7);
  });

  it.each(['aliasChildren', 'replaceByCopy'])(
    '%s: a change of identity is reported, never passed',
    (which) => {
      expect(run(which).found).toContain('cannot reproduce');
    },
  );
});

describe('write-back keeps the identity of Map keys and Set members', () => {
  it('changes the key objects of the caller in place', () => {
    const frame = isolate<Product>({ module: PRODUCT, seed: 11, plain: false });
    open.push(frame as Frame<unknown>);
    const key = { n: 1 };
    const member = { n: 100 };
    const table = new Map([[key, 'v']]);
    const bag = new Set([member]);
    (frame.product.changesKeys as (a: unknown) => unknown)({ table, bag });
    expect([...table.keys()][0]).toBe(key);
    expect(key.n).toBe(2);
    expect([...bag][0]).toBe(member);
    expect(member.n).toBe(110);
  });
});

describe('the end of a frame', () => {
  it('lets a caller wait until the relay worker has ended, so the process can exit without it', async () => {
    const frame = isolate<Product>({ module: PRODUCT, seed: 11, plain: false });
    frame.product.readsOnly({ deep: { list: [1] } });
    expect(frame.ended).toBeTypeOf('function');
    frame.close();
    await expect(frame.ended()).resolves.toBeUndefined();
  });
});
