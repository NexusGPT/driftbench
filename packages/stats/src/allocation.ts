/** Weights and strata: the design effect of unequal weights and the proportional allocation of a sample. */

import { assertFiniteValues } from './basics';

/**
 * The design effect of unequal weights, as Kish defines it: n * sum(w^2) / sum(w)^2. It is 1 plus the squared
 * coefficient of variation of the weights; equal weights give 1. Only the ratios between weights matter.
 */
export function kishDesignEffect(weights: readonly number[]): number {
  if (weights.length === 0) throw new RangeError('kishDesignEffect: weights must not be empty');
  assertFiniteValues('kishDesignEffect', 'weights', weights);
  let sum = 0;
  let squares = 0;
  weights.forEach((w, i) => {
    if (!(w > 0)) throw new RangeError(`kishDesignEffect: weights[${i}] must be above 0, got ${w}`);
    sum += w;
    squares += w * w;
  });
  return (weights.length * squares) / (sum * sum);
}

/**
 * The allocation of n units over strata in proportion to their sizes, in whole numbers, by the largest remainder
 * method: each stratum gets the floor of its quota n * size / N, and the units left go one each to the largest
 * remainders (ties to the lower index). Quotas and remainders are compared as exact integers.
 */
export function proportionalAllocation(strataSizes: readonly number[], n: number): number[] {
  const fn = 'proportionalAllocation';
  if (strataSizes.length === 0) throw new RangeError(`${fn}: strataSizes must not be empty`);
  strataSizes.forEach((size, i) => {
    if (!Number.isSafeInteger(size) || size < 0)
      throw new RangeError(`${fn}: strataSizes[${i}] must be a non-negative integer, got ${size}`);
  });
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(`${fn}: n must be a non-negative integer, got ${n}`);
  const total = strataSizes.reduce((sum, size) => sum + BigInt(size), 0n);
  if (total === 0n) throw new RangeError(`${fn}: strataSizes must not all be 0`);
  if (BigInt(n) > total) throw new RangeError(`${fn}: n (${n}) exceeds the sum of strataSizes (${total})`);
  const units = BigInt(n);
  const shares = strataSizes.map((size) => units * BigInt(size));
  const floors = shares.map((share) => share / total);
  const remainders = shares.map((share) => share % total);
  let left = Number(units - floors.reduce((sum, floor) => sum + floor, 0n));
  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  const out = floors.map((floor) => Number(floor));
  for (const { index } of order) {
    if (left <= 0) break;
    out[index] = (out[index] as number) + 1;
    left -= 1;
  }
  return out;
}
