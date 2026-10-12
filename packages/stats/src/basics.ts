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
  if (n === 0) throw new RangeError('quantileSorted: sorted must not be empty');
  assertFiniteValues('quantileSorted', 'sorted', sorted);
  if (!(p >= 0 && p <= 1)) throw new RangeError(`quantileSorted: p must lie in [0, 1], got ${p}`);
  for (let i = 1; i < n; i += 1) {
    if ((sorted[i] as number) < (sorted[i - 1] as number)) {
      throw new RangeError(
        `quantileSorted: sorted must be in ascending order, sorted[${i}] is below sorted[${i - 1}]`,
      );
    }
  }
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (h - lo) * (b - a);
}

/** Quantile of an unsorted sample, type 7. */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError('quantile: values must not be empty');
  if (!(p >= 0 && p <= 1)) throw new RangeError(`quantile: p must lie in [0, 1], got ${p}`);
  assertFiniteValues('quantile', 'values', values);
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

/**
 * Rule 1 of the degenerate-input contract for a data array: the first value that is not finite is named by its
 * function, argument and index, so the caller can find it.
 */
export function assertFiniteValues(fn: string, arg: string, values: readonly number[]): void {
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) throw new RangeError(`${fn}: ${arg}[${i}] must be finite, got ${v}`);
  });
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('mean: values must not be empty');
  assertFiniteValues('mean', 'values', values);
  const first = values[0] as number;
  // All-equal values have that value as mean exactly, with no rounding from the sum.
  if (values.every((v) => v === first)) return first;
  const m = sum(values) / values.length;
  // A sum that overflows is replaced by the sum of the values divided by n.
  return Number.isFinite(m) ? m : sum(values.map((v) => v / values.length));
}

/**
 * The weighted mean, sum(w x) / sum(w) (numpy.average). Throws a RangeError on no values, mismatched lengths,
 * a value or weight that is not finite, a negative weight, or weights that sum to zero.
 */
export function weightedMean(values: readonly number[], weights: readonly number[]): number {
  if (values.length === 0) throw new RangeError('weightedMean of an empty sample');
  if (values.length !== weights.length) {
    throw new RangeError(
      `weightedMean: values and weights must have the same length, got ${values.length} and ${weights.length}`,
    );
  }
  let sw = 0;
  let swx = 0;
  for (let i = 0; i < values.length; i += 1) {
    const x = values[i] as number;
    const w = weights[i] as number;
    if (!Number.isFinite(x)) throw new RangeError(`weightedMean: values[${i}] must be finite, got ${x}`);
    if (!Number.isFinite(w) || w < 0) {
      throw new RangeError(`weightedMean: weights[${i}] must be finite and not negative, got ${w}`);
    }
    sw += w;
    swx += w * x;
  }
  if (!(sw > 0)) throw new RangeError('weightedMean: the weights must not sum to zero');
  return swx / sw;
}

/** Sample variance with n - 1 in the denominator. */
export function sampleVariance(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) throw new RangeError('sampleVariance: values needs at least two values');
  assertFiniteValues('sampleVariance', 'values', values);
  const m = mean(values);
  let ss = 0;
  for (const v of values) ss += (v - m) * (v - m);
  return ss / (n - 1);
}

/** Rule 1: the message begins `<function>: <argument>`, so the caller sees which argument to fix. */
/** Rule 1 for a scalar: the message begins `<function>: <argument>` when the number is NaN or infinite. */
export function assertFinite(fn: string, name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${fn}: ${name} must be finite, got ${value}`);
}

export function assertCount(fn: string, name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${fn}: ${name} must be a non-negative integer, got ${value}`);
  }
}

export function assertProbability(fn: string, name: string, value: number, open = false): void {
  const ok = open ? value > 0 && value < 1 : value >= 0 && value <= 1;
  if (!ok || Number.isNaN(value)) {
    throw new RangeError(`${fn}: ${name} must lie in ${open ? '(0, 1)' : '[0, 1]'}, got ${value}`);
  }
}

export function assertSameLength(
  a: readonly unknown[],
  b: readonly unknown[],
  what: string,
  names: readonly [string, string] | undefined = undefined,
): void {
  if (a.length !== b.length) {
    const who = names ? `${names[0]} and ${names[1]}` : 'both inputs';
    throw new RangeError(`${what}: ${who} must have the same length, got ${a.length} and ${b.length}`);
  }
}
