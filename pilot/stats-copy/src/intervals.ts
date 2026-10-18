/** Intervals on rates: Wilson, Clopper-Pearson, the zero-failure count, the design effect and the clustered bootstrap. */

import { assertCount, assertFiniteValues, assertProbability, mulberry32, quantileSorted } from './basics';
import { betaQuantile, normalQuantile } from './special';

/** z for a two-sided 95 percent interval. */
export const Z95 = 1.959963984540054;

export interface Interval {
  /** The point estimate. */
  readonly estimate: number;
  readonly lower: number;
  readonly upper: number;
}

/** The Wilson score interval for k successes in n trials. */
export function wilson(k: number, n: number, z: number = Z95): Interval {
  assertCount('wilson: k', k);
  assertCount('wilson: n', n);
  if (n === 0) throw new RangeError('wilson: n must be at least 1');
  if (k > n) throw new RangeError(`wilson: k (${k}) exceeds n (${n})`);
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { estimate: p, lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

/** The exact (Clopper-Pearson) interval for k successes in n trials at level 1 - alpha. */
export function clopperPearson(k: number, n: number, alpha = 0.05): Interval {
  assertCount('clopperPearson: k', k);
  assertCount('clopperPearson: n', n);
  assertProbability('clopperPearson: alpha', alpha, true);
  if (n === 0) throw new RangeError('clopperPearson: n must be at least 1');
  if (k > n) throw new RangeError(`clopperPearson: k (${k}) exceeds n (${n})`);
  const lower = k === 0 ? 0 : betaQuantile(alpha / 2, k, n - k + 1);
  const upper = k === n ? 1 : betaQuantile(1 - alpha / 2, k + 1, n - k);
  return { estimate: k / n, lower, upper };
}

/**
 * The number of independent failure-free units needed to claim a failure rate below p at
 * confidence 1 - alpha: the smallest n with (1 - p)^n <= alpha, that is ceil(ln(alpha) / ln(1 - p)).
 * 59 for p = 0.05 at 95 percent.
 */
export function zeroFailureBound(p: number, alpha = 0.05): number {
  assertProbability('zeroFailureBound: p', p, true);
  assertProbability('zeroFailureBound: alpha', alpha, true);
  const exact = Math.log(alpha) / Math.log(1 - p);
  // Guard against floating noise when the ratio is an exact integer.
  const rounded = Math.round(exact);
  return Math.abs(exact - rounded) < 1e-9 ? rounded : Math.ceil(exact);
}

/** The design effect 1 + (m - 1) rho for clusters of size m with intraclass correlation rho. */
export function designEffect(m: number, rho: number): number {
  if (!(m >= 1)) throw new RangeError(`designEffect: m must be at least 1, got ${m}`);
  if (!(rho >= -1 && rho <= 1)) throw new RangeError(`designEffect: rho must lie in [-1, 1], got ${rho}`);
  return 1 + (m - 1) * rho;
}

/** The effective number of independent units: n divided by the design effect. */
export function effectiveSampleSize(n: number, m: number, rho: number): number {
  return n / designEffect(m, rho);
}

/**
 * Kish's effective sample size of weighted units, (sum w)^2 / sum w^2 (Owen, Monte Carlo theory, chapter 9,
 * equation 9.13). The weights are scaled by their largest, so large weights do not overflow.
 */
export function kishEffectiveSize(weights: readonly number[]): number {
  if (weights.length === 0) throw new RangeError('kishEffectiveSize: weights is empty');
  assertFiniteValues(weights, 'kishEffectiveSize: weights');
  let largest = 0;
  for (let i = 0; i < weights.length; i += 1) {
    const w = weights[i] as number;
    if (w < 0) throw new RangeError(`kishEffectiveSize: weights must be non-negative, got ${w} at index ${i}`);
    if (w > largest) largest = w;
  }
  if (!(largest > 0)) throw new RangeError('kishEffectiveSize: weights must have a positive sum');
  let total = 0;
  let squares = 0;
  for (const w of weights) {
    const u = w / largest;
    total += u;
    squares += u * u;
  }
  return (total * total) / squares;
}

export interface BootstrapOptions {
  /** Cluster key per value, same length as values. Without it every value is its own cluster. */
  readonly clusters?: readonly (string | number)[];
  /** Number of bootstrap resamples. Default 2000. */
  readonly iterations?: number;
  /** 'percentile' (default) or 'basic' (the reflected percentile interval). */
  readonly method?: 'percentile' | 'basic';
  /** Two-sided level: the interval covers 1 - alpha. Default 0.05. */
  readonly alpha?: number;
  /** Seed of the generator. Default 1. The same seed gives the same interval. */
  readonly seed?: number;
  /**
   * Statistic over the resampled values (all values of the drawn clusters, concatenated in draw
   * order). Default: the pooled mean, so a cluster weighs by its size.
   */
  readonly statistic?: (values: readonly number[]) => number;
}

export interface BootstrapInterval extends Interval {
  readonly iterations: number;
  readonly clusters: number;
  readonly method: 'percentile' | 'basic';
  readonly seed: number;
}

/**
 * A bootstrap interval that resamples whole clusters with replacement (one conversation or one task
 * is one cluster), so values inside a cluster are never treated as independent.
 */
export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  const iterations = options.iterations ?? 2000;
  const method = options.method ?? 'percentile';
  const alpha = options.alpha ?? 0.05;
  const seed = options.seed ?? 1;
  if (values.length === 0) throw new RangeError('bootstrapCI: values is empty');
  assertFiniteValues(values, 'bootstrapCI: values');
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new RangeError(`bootstrapCI: iterations must be a positive integer, got ${iterations}`);
  }
  assertProbability('bootstrapCI: alpha', alpha, true);
  const keys = options.clusters;
  if (keys && keys.length !== values.length) {
    throw new RangeError(`bootstrapCI: clusters has ${keys.length} keys for ${values.length} values`);
  }

  // Group values by cluster, in order of first appearance.
  const groups: number[][] = [];
  if (keys) {
    const index = new Map<string | number, number>();
    values.forEach((v, i) => {
      const key = keys[i] as string | number;
      let g = index.get(key);
      if (g === undefined) {
        g = groups.length;
        index.set(key, g);
        groups.push([]);
      }
      (groups[g] as number[]).push(v);
    });
  } else {
    for (const v of values) groups.push([v]);
  }

  const statistic = options.statistic;
  const sums = groups.map((g) => g.reduce((a, b) => a + b, 0));
  const sizes = groups.map((g) => g.length);
  const pooled = (drawn: readonly number[]): number => {
    let s = 0;
    let c = 0;
    for (const g of drawn) {
      s += sums[g] as number;
      c += sizes[g] as number;
    }
    return s / c;
  };
  const evaluate = (drawn: readonly number[]): number => {
    if (!statistic) return pooled(drawn);
    const flat: number[] = [];
    for (const g of drawn) for (const v of groups[g] as number[]) flat.push(v);
    return statistic(flat);
  };

  const all = groups.map((_, g) => g);
  const estimate = evaluate(all);
  const rng = mulberry32(seed);
  const g = groups.length;
  const stats: number[] = new Array(iterations);
  const drawn: number[] = new Array(g);
  for (let it = 0; it < iterations; it += 1) {
    for (let j = 0; j < g; j += 1) drawn[j] = Math.floor(rng() * g);
    stats[it] = evaluate(drawn);
  }
  stats.sort((a, b) => a - b);
  const qLow = quantileSorted(stats, alpha / 2);
  const qHigh = quantileSorted(stats, 1 - alpha / 2);
  const [lower, upper] = method === 'basic' ? [2 * estimate - qHigh, 2 * estimate - qLow] : [qLow, qHigh];
  return { estimate, lower, upper, iterations, clusters: g, method, seed };
}

/** z for a two-sided interval at level 1 - alpha. */
export function zFor(alpha: number): number {
  assertProbability('zFor: alpha', alpha, true);
  return normalQuantile(1 - alpha / 2);
}
