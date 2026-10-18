/** Small shared helpers: a seeded random generator, quantiles, means and input checks. */

/**
 * Mulberry32: a 32-bit seeded generator. The same seed gives the same sequence on every platform,
 * which is what makes a bootstrap interval reproducible. Returns uniform numbers in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Quantile of a sample with linear interpolation between order statistics (Hyndman and Fan type 7,
 * the default of numpy and R). `sorted` must already be in ascending order.
 */
export function quantileSorted(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) throw new RangeError('quantileSorted: sorted is empty');
  if (!(p >= 0 && p <= 1)) throw new RangeError(`quantileSorted: p must lie in [0, 1], got ${p}`);
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (h - lo) * (b - a);
}

/** Quantile of an unsorted sample, type 7. */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError('quantile: values is empty');
  if (!(p >= 0 && p <= 1)) throw new RangeError(`quantile: p must lie in [0, 1], got ${p}`);
  return quantileSorted(
    [...values].sort((x, y) => x - y),
    p,
  );
}

export function sum(values: readonly number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('mean: values is empty');
  return sum(values) / values.length;
}

/** Sample variance with n - 1 in the denominator. */
export function sampleVariance(values: readonly number[]): number {
  const n = values.length;
  if (n === 0) throw new RangeError('sampleVariance: values is empty');
  if (n < 2) throw new RangeError('sampleVariance: values needs at least two values');
  const m = mean(values);
  let ss = 0;
  for (const v of values) ss += (v - m) * (v - m);
  return ss / (n - 1);
}

export function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

export function assertProbability(name: string, value: number, open = false): void {
  const ok = open ? value > 0 && value < 1 : value >= 0 && value <= 1;
  if (!ok || Number.isNaN(value)) {
    throw new RangeError(`${name} must lie in ${open ? '(0, 1)' : '[0, 1]'}, got ${value}`);
  }
}

export function assertSameLength(
  a: readonly unknown[],
  b: readonly unknown[],
  fn: string,
  args = 'a or b',
): void {
  if (a.length !== b.length) {
    throw new RangeError(`${fn}: ${args} must have the same length, got ${a.length} and ${b.length}`);
  }
}
