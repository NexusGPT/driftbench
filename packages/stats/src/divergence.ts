/** Distances between probability vectors. */

import { assertFiniteValues, sum } from './basics';

/** The largest allowed distance of the sum of a probability vector from 1. */
const SUM_TOLERANCE = 1e-9;

function assertProbabilityVector(fn: string, name: string, p: readonly number[]): void {
  if (p.length === 0) throw new RangeError(`${fn}: ${name} must not be empty`);
  assertFiniteValues(fn, name, p);
  p.forEach((v, i) => {
    if (v < 0 || v > 1) throw new RangeError(`${fn}: ${name}[${i}] must lie in [0, 1], got ${v}`);
  });
  const total = sum(p);
  if (Math.abs(total - 1) > SUM_TOLERANCE)
    throw new RangeError(`${fn}: ${name} must sum to 1 within ${SUM_TOLERANCE}, got ${total}`);
}

/**
 * 0.5 * sum(|p[i] - q[i]|): the largest difference in probability that two vectors give to one event.
 * Both arguments are probability vectors of the same length (the bins of one histogram, in the same order).
 */
export function totalVariationDistance(p: readonly number[], q: readonly number[]): number {
  assertProbabilityVector('totalVariationDistance', 'p', p);
  assertProbabilityVector('totalVariationDistance', 'q', q);
  if (p.length !== q.length) {
    throw new RangeError(
      `totalVariationDistance: p and q must have the same length, got ${p.length} and ${q.length}`,
    );
  }
  let total = 0;
  for (let i = 0; i < p.length; i += 1) total += Math.abs((p[i] as number) - (q[i] as number));
  return 0.5 * total;
}
