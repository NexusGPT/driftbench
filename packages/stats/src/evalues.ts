/** E-values: non-negative numbers whose expected value is at most 1 under the null. */

import { mean } from './basics';

/**
 * The arithmetic mean of e-values. The mean of e-values is an e-value under any dependence between them. The mean
 * of `basics.ts` is used, so the sum of large values does not overflow.
 */
export function eValueAverage(evalues: readonly number[]): number {
  const fn = 'eValueAverage';
  if (evalues.length === 0) throw new RangeError(`${fn}: evalues must not be empty`);
  evalues.forEach((e, i) => {
    if (!Number.isFinite(e) || e < 0)
      throw new RangeError(`${fn}: evalues[${i}] must be a finite number of at least 0, got ${e}`);
  });
  return mean(evalues);
}
