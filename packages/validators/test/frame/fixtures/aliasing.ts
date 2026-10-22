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
