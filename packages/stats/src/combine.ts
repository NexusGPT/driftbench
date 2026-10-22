/** Combining p-values for one shared null hypothesis. */

/**
 * The Simes p-value of the global null: with the p-values sorted ascending, the minimum over ranks i of
 * m p(i) / i. It never exceeds the largest p-value, so it is at most 1.
 */
export function simesPValue(pvalues: readonly number[]): number {
  const fn = 'simesPValue';
  const m = pvalues.length;
  if (m === 0) throw new RangeError(`${fn}: pvalues must not be empty`);
  pvalues.forEach((p, i) => {
    if (!(p >= 0 && p <= 1)) throw new RangeError(`${fn}: pvalues[${i}] must lie in [0, 1], got ${p}`);
  });
  const sorted = [...pvalues].sort((a, b) => a - b);
  let result = 1;
  sorted.forEach((p, i) => {
    result = Math.min(result, (m * p) / (i + 1));
  });
  return result;
}
