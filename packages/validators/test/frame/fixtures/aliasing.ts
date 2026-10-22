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

let earlier: { total: number } | undefined;
/** A new object on every call, and the earlier one overwritten with the new total. */
export const overwrite = (xs: readonly number[]) => {
  const result = { total: xs.reduce((a, b) => a + b, 0) };
  if (earlier) earlier.total = result.total;
  earlier = result;
  return result;
};
