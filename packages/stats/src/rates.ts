/** Error rates for many tests. */

/**
 * The level for each of m tests that keeps the family-wise error rate at most alpha: alpha / m. m is a
 * positive integer and alpha lies in [0, 1].
 */
export function bonferroniThreshold(m: number, alpha: number): number {
  if (!Number.isSafeInteger(m) || m < 1)
    throw new RangeError(`bonferroniThreshold: m must be a positive integer, got ${m}`);
  if (!(alpha >= 0 && alpha <= 1))
    throw new RangeError(`bonferroniThreshold: alpha must lie in [0, 1], got ${alpha}`);
  return alpha / m;
}
