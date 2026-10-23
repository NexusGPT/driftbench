// Fictional products for the identity test of the frame.

/** Rows that hold the caller's own seed objects. */
export const rowsOf = (seeds: Array<Record<string, string>>) => ({
  rows: seeds.map((values) => ({ values })),
});

const cached = new Map<string, { total: number }>();
/** One cached object for the same input. */
export const cachedTotal = (xs: number[]) => {
  const key = JSON.stringify(xs);
  if (!cached.has(key)) cached.set(key, { total: xs.reduce((a, b) => a + b, 0) });
  return cached.get(key);
};

const byObject = new WeakMap<object, number>();
/** A count cached by the identity of its input object: an input edited in place gives the stale count. */
export const countOf = (input: { items: number[] }) => {
  const hit = byObject.get(input);
  if (hit !== undefined) return hit;
  byObject.set(input, input.items.length);
  return input.items.length;
};

const state = { calls: 0 };
/** The same object on every call, changed by the product after it was returned. */
export const counter = () => {
  state.calls += 1;
  return state;
};

/** A Map and a Set that hold the caller's own objects, as a value, a key and a member. */
export const holders = (item: { n: number }) => ({
  byValue: new Map([['item', item]]),
  byKey: new Map([[item, 'item']]),
  members: new Set([item]),
});

const frozenSeen = new WeakMap<object, number>();
let frozenNext = 4;
/** A count cached by the identity of a frozen input. */
export const frozenCount = (input: Readonly<{ id: string }>) => {
  const hit = frozenSeen.get(input);
  if (hit !== undefined) return hit;
  frozenSeen.set(input, frozenNext);
  frozenNext += 1;
  return frozenSeen.get(input);
};

const heldInMap = new WeakMap<object, number>();
/** A count cached by the identity of an object the caller sends inside a Map. */
export const countInMap = (input: Map<string, { items: number[] }>) => {
  const inner = input.get('x');
  if (!inner) return -1;
  const hit = heldInMap.get(inner);
  if (hit !== undefined) return hit;
  heldInMap.set(inner, inner.items.length);
  return inner.items.length;
};
