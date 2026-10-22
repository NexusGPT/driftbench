// Fictional products for the aliased-result test: each hands out `{ total }` objects for the sum of a list.

/** A new object on every call. */
export const fresh = (xs: readonly number[]) => ({ total: xs.reduce((a, b) => a + b, 0) });

const reused = { total: 0 };
/** One object, filled again on every call. */
export const shared = (xs: readonly number[]) => {
  reused.total = xs.reduce((a, b) => a + b, 0);
  return reused;
};

/** A Proxy over a correct result, and a plain result that holds one. */
export const proxied = (xs: readonly number[]) => new Proxy({ total: xs.reduce((a, b) => a + b, 0) }, {});
export const holding = (xs: readonly number[]) => ({
  total: xs.reduce((a, b) => a + b, 0),
  inner: new Proxy({}, {}),
});

/** Results that hold an accessor property: a getter, and a setter alone. */
export const withGetter = (xs: readonly number[]) =>
  Object.defineProperty({ total: 0 }, 'sum', { enumerable: true, get: () => xs.reduce((a, b) => a + b, 0) });
export const withSetter = (xs: readonly number[]) =>
  Object.defineProperty({ total: xs.reduce((a, b) => a + b, 0) }, 'note', { enumerable: true, set() {} });

let earlier: { total: number } | undefined;
/** A new object on every call, and the earlier one overwritten with the new total. */
export const overwrite = (xs: readonly number[]) => {
  const result = { total: xs.reduce((a, b) => a + b, 0) };
  if (earlier) earlier.total = result.total;
  earlier = result;
  return result;
};

/** A Map and an array that carry an accessor as an extra own property. */
export const mapWithAccessor = () =>
  Object.defineProperty(new Map([['a', 1]]), 'extra', { enumerable: true, get: () => 1 });
export const arrayWithAccessor = () =>
  Object.defineProperty([1, 2, 3], 'extra', { enumerable: true, get: () => 1 });

let spoofed: Float64Array | undefined;
let fills = 0;
/** One typed array refilled on every call, whose own `length` property says 0. */
export const sharedTyped = () => {
  if (!spoofed) {
    spoofed = new Float64Array(4);
    Object.defineProperty(spoofed, 'length', { value: 0 });
  }
  fills += 1;
  spoofed.fill(fills);
  return spoofed;
};

/** A result with an array whose element 1 is a getter, and one whose element 1 is a setter alone. */
export const withArrayGetter = () => Object.defineProperty([1, 2, 3], 1, { enumerable: true, get: () => 2 });
export const withArraySetter = () => Object.defineProperty([1, 2, 3], 1, { enumerable: true, set() {} });

/** Writes to a nested array of its argument and puts the value back before it returns. */
export const touchesAndRestores = (input: { deep: { list: number[] } }) => {
  const kept = input.deep.list[0] as number;
  input.deep.list[0] = kept + 1;
  input.deep.list[0] = kept;
  return input.deep.list.length;
};

/** Reads its argument only. */
export const readsOnly = (input: { deep: { list: number[] } }) => input.deep.list.length;

/** Sorts its argument in place and answers its length. */
export const sortsInPlace = (list: number[]) => list.sort((a, b) => b - a).length;

/** Fills a typed array argument and a Map argument in place (a freeze does not stop either). */
export const fillsTyped = (input: { bytes: Uint8Array }) => {
  input.bytes[0] = 9;
  return input.bytes.length;
};
export const fillsMap = (input: { table: Map<string, number> }) => {
  input.table.set('x', 1);
  return input.table.size;
};

/** Computes its answer, then fills the argument, shortens another and deletes a key of a third. */
export const changesAfterwards = (input: {
  list: number[];
  tail: number[];
  keyed: Record<string, number>;
}) => {
  const total = input.list.reduce((a, b) => a + b, 0);
  input.list.fill(10000);
  input.tail.length = 1;
  input.tail.push(7);
  delete input.keyed.gone;
  input.keyed.added = 1;
  return total;
};

/** Changes a Map, a Set, a typed array and a Date argument in place. */
export const changesContainers = (input: {
  table: Map<string, number>;
  bag: Set<number>;
  bytes: Uint8Array;
  when: Date;
}) => {
  input.table.clear();
  input.table.set('a', 5);
  input.bag.add(9);
  input.bytes[1] = 8;
  input.when.setTime(1000);
  return input.table.size;
};

/** Writes only to its own copy, never to an argument. */
export const writesToACopy = (input: { list: number[] }) => {
  const copy = [...input.list].sort((a, b) => b - a);
  return copy.length;
};

/** The state a caller hands to `applyWrites`. */
export const writeTarget = () => ({
  list: [1, 2, 3, 4],
  inner: {
    deep: [5, 6, 7],
    plain: { a: 1, b: 2 } as Record<string, unknown>,
    tbl: new Map<string, number>([['x', 1]]),
    bag: new Set<number>([1, 2]),
    bytes: new Uint8Array(4),
    when: new Date(0),
  },
});
export type WriteTarget = ReturnType<typeof writeTarget>;

/** One write of a program: a kind of write on a target (a key of `targets`). */
export type Write = { target: string; kind: string };

/** The writes each kind of target takes; `copy` marks the ones the frame can copy back to the caller. */
export const WRITES: Record<string, { name: string; copy: boolean }[]> = {
  array: [
    ...['fill', 'set', 'pop', 'push', 'reverse', 'sort', 'noop'].map((name) => ({
      name,
      copy: true,
    })),
    ...[
      'delete',
      'ownMap',
      'hidden',
      'extra',
      'symbol',
      'accessor',
      'proto',
      'protoObject',
      'protoNull',
      'preventExt',
    ].map((name) => ({
      name,
      copy: false,
    })),
  ],
  plain: [
    ...['set', 'delete', 'add'].map((name) => ({ name, copy: true })),
    ...['hidden', 'symbol', 'accessor', 'fnValue', 'proto', 'protoObject', 'protoNull', 'preventExt'].map(
      (name) => ({
        name,
        copy: false,
      }),
    ),
  ],
  map: [...['set', 'delete', 'clear'].map((name) => ({ name, copy: true })), { name: 'extra', copy: false }],
  set: [...['add', 'delete', 'clear'].map((name) => ({ name, copy: true })), { name: 'extra', copy: false }],
  typed: [
    { name: 'set', copy: true },
    { name: 'extra', copy: false },
  ],
  date: [
    { name: 'set', copy: true },
    { name: 'extra', copy: false },
  ],
};
export const TARGETS: Record<string, { kind: keyof typeof WRITES; get: (t: WriteTarget) => unknown }> = {
  list: { kind: 'array', get: (t) => t.list },
  deep: { kind: 'array', get: (t) => t.inner.deep },
  plain: { kind: 'plain', get: (t) => t.inner.plain },
  tbl: { kind: 'map', get: (t) => t.inner.tbl },
  bag: { kind: 'set', get: (t) => t.inner.bag },
  bytes: { kind: 'typed', get: (t) => t.inner.bytes },
  when: { kind: 'date', get: (t) => t.inner.when },
};

/** Applies a program of writes to its input, in place. The same function runs in the product and in the test. */
export const applyWrites = (input: WriteTarget, program: Write[]) => {
  for (const { target, kind } of program) {
    const o = (TARGETS[target] as (typeof TARGETS)[string]).get(input) as any;
    switch (`${TARGETS[target]?.kind}:${kind}`) {
      case 'array:fill':
        o.fill(9);
        break;
      case 'array:set':
        o[1] = 42;
        break;
      case 'array:pop':
        o.pop();
        break;
      case 'array:push':
        o.push(11, 12);
        break;
      case 'array:delete':
        delete o[0];
        break;
      case 'array:reverse':
        o.reverse();
        break;
      case 'array:sort':
        o.sort((a: number, b: number) => b - a);
        break;
      case 'array:noop':
        o.tmp = 1;
        delete o.tmp;
        break;
      case 'array:ownMap':
        o.map = Array.prototype.filter;
        break;
      case 'plain:set':
        o.a = 'changed';
        break;
      case 'plain:delete':
        delete o.b;
        break;
      case 'plain:add':
        o.c = [1, 2];
        break;
      case 'plain:fnValue':
        o.f = () => 1;
        break;
      case 'map:set':
        o.set('y', 2);
        break;
      case 'map:delete':
        o.delete('x');
        break;
      case 'map:clear':
        o.clear();
        break;
      case 'set:add':
        o.add(7);
        break;
      case 'set:delete':
        o.delete(1);
        break;
      case 'set:clear':
        o.clear();
        break;
      case 'typed:set':
        o[2] = 5;
        break;
      case 'date:set':
        o.setTime(5000);
        break;
      default:
        if (kind === 'hidden')
          Object.defineProperty(o, 'hid', { value: 1, enumerable: false, configurable: true });
        else if (kind === 'extra') o.extra = 1;
        else if (kind === 'symbol') o[Symbol('s')] = 1;
        else if (kind === 'accessor') Object.defineProperty(o, 'acc', { get: () => 1, configurable: true });
        else if (kind === 'proto') Object.setPrototypeOf(o, Object.create(Object.getPrototypeOf(o)));
        else if (kind === 'protoObject') Object.setPrototypeOf(o, Object.prototype);
        else if (kind === 'protoNull') Object.setPrototypeOf(o, null);
        else if (kind === 'preventExt') Object.preventExtensions(o);
        else throw new Error(`no write ${TARGETS[target]?.kind}:${kind}`);
    }
  }
  return program.length;
};

const holder: { run: () => number } = { run: () => 0 };
let swaps = 0;
/** Returns one object whose function field is replaced by another function with the same source on every call. */
export const swapsFunction = () => {
  swaps += 1;
  const n = swaps;
  holder.run = () => n;
  return holder;
};
/** Returns a new object each call holding the same function. */
const sameFn = () => 1;
export const keepsFunction = () => ({ run: sameFn });
