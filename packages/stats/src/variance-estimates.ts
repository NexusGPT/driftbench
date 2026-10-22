/** Variance estimates by resampling. */

import { assertFiniteValues } from './basics';

/**
 * The jackknife estimate of the variance of the sample mean: (n - 1) / n * sum (mean_i - mean_dot)^2, mean_i the
 * mean without value i and mean_dot the mean of those n means. It equals the sample variance over n.
 */
export function jackknifeMeanVariance(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) throw new RangeError(`jackknifeMeanVariance: xs needs at least two values, got ${n}`);
  assertFiniteValues('jackknifeMeanVariance', 'xs', xs);
  const mean = xs.reduce((sum, x) => sum + x, 0) / n;
  // Deviations from the mean, not a difference of a sum of squares and a squared sum.
  const leaveOut = xs.map((x) => mean + (mean - x) / (n - 1));
  const dot = leaveOut.reduce((sum, m) => sum + m, 0) / n;
  let squares = 0;
  for (const m of leaveOut) squares += (m - dot) * (m - dot);
  return ((n - 1) / n) * squares;
}
