// A fictional product for the evidence test of the aliased-result watch: it exports functions only, so no handle is
// given while the module loads.

let earlier: { total: number; read: () => number } | undefined;
/** A result that holds a function, and the earlier one overwritten with the new total. */
export const holdsFunction = (xs: readonly number[]) => {
  const total = xs.reduce((a, b) => a + b, 0);
  const result = { total, read: () => total };
  if (earlier) earlier.total = total;
  earlier = result;
  return result;
};
