import { bootstrapCI, wilson } from '@driftbench/stats';

/**
 * How an interval was made:
 * - `wilson`: the Wilson score interval on k of n.
 * - `cluster bootstrap`: the percentile bootstrap of @driftbench/stats, resampling whole clusters (2000
 *   draws, seed 1), so the values inside one conversation are never read as independent.
 * - `wilson, raised`: pass^k and pass@k, the Wilson bounds of the per-run rate put through the same
 *   monotone map (p^k, 1 - (1 - p)^k).
 * - `newcombe`: the paired difference of two rates (Newcombe's method 10).
 * - `none`: one cluster only, so no interval can be drawn; lower and upper equal the estimate.
 */
export type IntervalMethod = 'wilson' | 'cluster bootstrap' | 'wilson, raised' | 'newcombe' | 'none';

/** A point estimate with its 95% interval and how the interval was made. */
export type Estimate = {
  estimate: number;
  lower: number;
  upper: number;
  method: IntervalMethod;
  /** The units the estimate stands on: runs, blocks, units, verdicts. */
  n: number;
  /** For a cluster bootstrap, the clusters resampled. */
  clusters?: number;
};

/** A rate: k of n, with its Wilson interval. */
export type Rate = Estimate & { k: number };

/** k of n with the Wilson interval; undefined when n is 0. */
export function rate(k: number, n: number): Rate | undefined {
  if (n === 0) return undefined;
  const w = wilson(k, n);
  return { k, n, estimate: w.estimate, lower: w.lower, upper: w.upper, method: 'wilson' };
}

/**
 * The mean of values with a cluster bootstrap interval: one key per value, a cluster being one
 * conversation (a run) or one spec. With a single cluster the method is `none`. Undefined with no value.
 * `statistic` replaces the pooled mean (see bootstrapCI).
 */
export function clustered(
  values: readonly number[],
  clusters: readonly (string | number)[],
  statistic?: (values: readonly number[]) => number,
): Estimate | undefined {
  if (values.length === 0) return undefined;
  const result = bootstrapCI(values, { clusters, seed: 1, ...(statistic ? { statistic } : {}) });
  if (result.clusters < 2) {
    return {
      estimate: result.estimate,
      lower: result.estimate,
      upper: result.estimate,
      method: 'none',
      n: values.length,
      clusters: result.clusters,
    };
  }
  return {
    estimate: result.estimate,
    lower: result.lower,
    upper: result.upper,
    method: 'cluster bootstrap',
    n: values.length,
    clusters: result.clusters,
  };
}

/** The median of a non-empty list (the mean of the two middle values for an even count). */
export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
