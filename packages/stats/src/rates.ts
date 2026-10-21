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

function assertLevel(fn: string, alpha: number): void {
  if (!(alpha >= 0 && alpha <= 1)) throw new RangeError(`${fn}: alpha must lie in [0, 1], got ${alpha}`);
}

/**
 * The chance of at least one false rejection in m independent tests of true nulls, each at level alpha:
 * 1 - (1 - alpha)^m, taken as -expm1(m log1p(-alpha)) so that a small level keeps its relative accuracy.
 */
export function familywiseErrorRate(m: number, alpha: number): number {
  const fn = 'familywiseErrorRate';
  if (!Number.isSafeInteger(m) || m < 0)
    throw new RangeError(`${fn}: m must be a non-negative integer, got ${m}`);
  assertLevel(fn, alpha);
  if (m === 0) return 0;
  return -Math.expm1(m * Math.log1p(-alpha));
}

/**
 * The level for each of m independent tests that makes the family-wise rate exactly alpha:
 * 1 - (1 - alpha)^(1 / m), taken as -expm1(log1p(-alpha) / m).
 */
export function sidakThreshold(m: number, alpha: number): number {
  const fn = 'sidakThreshold';
  if (!Number.isSafeInteger(m) || m < 1)
    throw new RangeError(`${fn}: m must be a positive integer, got ${m}`);
  assertLevel(fn, alpha);
  return -Math.expm1(Math.log1p(-alpha) / m);
}
