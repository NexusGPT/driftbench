/** E-values: non-negative numbers whose expected value is at most 1 under the null. */

/**
 * The arithmetic mean of e-values: the sum over the count. The mean of e-values is an e-value under any dependence
 * between them.
 */
export function eValueAverage(evalues: readonly number[]): number {
  const fn = 'eValueAverage';
  if (evalues.length === 0) throw new RangeError(`${fn}: evalues must not be empty`);
  let sum = 0;
  evalues.forEach((e, i) => {
    if (!Number.isFinite(e) || e < 0)
      throw new RangeError(`${fn}: evalues[${i}] must be a finite number of at least 0, got ${e}`);
    sum += e;
  });
  return sum / evalues.length;
}
