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
