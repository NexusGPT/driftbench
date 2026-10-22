/** Beta distribution tails for whole shape parameters. */

import { binomialCdf } from './special';

/**
 * P(X > x) for X with a Beta(a, b) distribution, a and b whole numbers: the probability that a Binomial with
 * a + b - 1 trials and rate x gives at most a - 1 successes. It is 1 for x = 0 and 0 for x = 1.
 */
export function betaTailProbability(a: number, b: number, x: number): number {
  const fn = 'betaTailProbability';
  for (const [name, shape] of [
    ['a', a],
    ['b', b],
  ] as const) {
    if (!Number.isSafeInteger(shape) || shape < 1)
      throw new RangeError(`${fn}: ${name} must be a whole number of at least 1, got ${shape}`);
  }
  if (!(x >= 0 && x <= 1)) throw new RangeError(`${fn}: x must lie in [0, 1], got ${x}`);
  if (x === 0) return 1;
  if (x === 1) return 0;
  return binomialCdf(a - 1, a + b - 1, x);
}
