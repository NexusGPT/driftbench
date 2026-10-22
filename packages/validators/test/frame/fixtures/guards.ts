// Fictional products for the guard tests: small functions on lists, each with one fault the frame must see.

/** Correct: reads its argument, returns a new object. */
export const total = (xs: number[]) => ({ total: xs.reduce((a, b) => a + b, 0) });

/** Sorts its argument in place before it sums it. */
export const sortsInPlace = (xs: number[]) => {
  xs.sort((a, b) => a - b);
  return { total: xs.reduce((a, b) => a + b, 0), first: xs[0] };
};

/** Returns an object that is part of its argument. */
export const returnsItsArgument = (box: { items: number[] }) => box.items;

/** Returns the same object on every call. */
const kept = { total: 0 };
export const returnsTheSameObject = (xs: number[]) => {
  kept.total = xs.reduce((a, b) => a + b, 0);
  return { inner: kept };
};

/** Keeps the result for an object it has seen, by identity: stale after an edit in place. */
const cache = new WeakMap<object, { total: number }>();
export const cachesByObject = (xs: number[]) => {
  const hit = cache.get(xs);
  if (hit) return hit;
  const made = { total: xs.reduce((a, b) => a + b, 0) };
  cache.set(xs, made);
  return made;
};

/** Writes to its argument only when it is not frozen, and says whether it could. */
export const writesWhenItCan = (xs: number[]) => {
  try {
    xs.push(1);
    return { wrote: true };
  } catch {
    return { wrote: false };
  }
};

/** Reads the random source and the clock. */
export const reads = () => ({ now: Date.now(), draw: Math.random() > 2 ? 1 : 0 });
export const throwsOnRandom = () => {
  Math.random();
  return { ok: true };
};

/** The functions as an object, like the variables adapter: `variablesImpl`. */
export const variablesImpl = { twice: (n: number) => n * 2 };
