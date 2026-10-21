/** Means of positive values: the geometric and the harmonic mean. */

import { assertFiniteValues, sum } from './basics';

function assertPositiveValues(fn: string, values: readonly number[]): void {
  if (values.length === 0) throw new RangeError(`${fn}: xs must not be empty`);
  assertFiniteValues(fn, 'xs', values);
  values.forEach((v, i) => {
    if (!(v > 0)) throw new RangeError(`${fn}: xs[${i}] must be greater than 0, got ${v}`);
  });
}

/** The n-th root of the product, as exp(sum(log x) / n), so a long array does not overflow the product. */
export function geometricMean(xs: readonly number[]): number {
  assertPositiveValues('geometricMean', xs);
  return Math.exp(sum(xs.map((x) => Math.log(x))) / xs.length);
}

/** n / sum(1 / x). */
export function harmonicMean(xs: readonly number[]): number {
  assertPositiveValues('harmonicMean', xs);
  return xs.length / sum(xs.map((x) => 1 / x));
}
