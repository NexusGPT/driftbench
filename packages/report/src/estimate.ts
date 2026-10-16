import { bootstrapCI, wilson, wilsonEffective } from '@agent-nexus/driftbench-stats';

/**
 * How an interval was made:
 * - `wilson`: the Wilson score interval on k of n.
 * - `cluster bootstrap`: the percentile bootstrap of @agent-nexus/driftbench-stats, resampling whole clusters (2000
 *   draws, seed 1), so the values inside one conversation are never read as independent.
 * - `wilson, raised`: pass^k and pass@k, the Wilson bounds of the per-run rate put through the same
 *   monotone map (p^k, 1 - (1 - p)^k).
 * - `wilson, design effect`: a pass rate over clusters (pass flags, 0 or 1, with at least two clusters
 *   and values that differ): the Wilson interval on the effective number of runs, the runs divided by the
 *   design effect that the spread of the cluster rates implies, with the Student t quantile on the
 *   clusters less one in place of z. A percentile bootstrap over a handful of clusters is too narrow. The
 *   estimate carries `designEffect` and `effectiveN`.
 * - `hierarchical`: the pass rate of a suite as the mean over trees, with the hierarchical Beta-Bernoulli
 *   interval of @agent-nexus/driftbench-stats (no sampling, no seed). The suite headline uses it.
 * - `wilson, clusters`: a pass rate whose values all agree (all pass or all fail), where a bootstrap has no
 *   width: the Wilson interval over the clusters, each cluster counted once.
 * - `newcombe`: the paired difference of two rates (Newcombe's method 10).
 * - `none`: one cluster only, so no interval can be drawn; lower and upper equal the estimate.
 */
export type IntervalMethod =
  | 'wilson'
  | 'cluster bootstrap'
  | 'wilson, clusters'
  | 'wilson, design effect'
  | 'wilson, raised'
  | 'hierarchical'
  | 'newcombe'
  | 'none';

/** A point estimate with its 95% interval and how the interval was made. */
export type Estimate = {
  estimate: number;
  lower: number;
  upper: number;
  method: IntervalMethod;
  /** The units the estimate stands on: runs, blocks, units, verdicts. */
  n: number;
  /** For a cluster bootstrap or a design effect interval, the clusters. */
  clusters?: number;
  /** For a design effect interval: the design effect and the independent units the clusters are worth (n / design effect). */
  designEffect?: number;
  effectiveN?: number;
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
 * conversation (a run) or one spec. With a single cluster the method is `none`. A pass rate whose values all
 * agree (`rate`: the values are pass flags, 0 or 1) takes the Wilson interval over the clusters. `statistic`
 * replaces the pooled mean (see bootstrapCI). Undefined with no value.
 */
export function clustered(
  values: readonly number[],
  clusters: readonly (string | number)[],
  options: { statistic?: (values: readonly number[]) => number; rate?: boolean } = {},
): Estimate | undefined {
  if (values.length === 0) return undefined;
  const statistic = options.statistic;
  const first = values[0] as number;
  if (options.rate && !statistic) {
    const g = new Set(clusters).size;
    if (g >= 2 && values.every((v) => v === first)) {
      // Every value agrees: resampling cannot move the mean. Count each cluster once instead.
      const w = wilson(first === 1 ? g : 0, g);
      return {
        estimate: first,
        lower: w.lower,
        upper: w.upper,
        method: 'wilson, clusters',
        n: values.length,
        clusters: g,
      };
    }
    if (g >= 2 && values.every((v) => v === 0 || v === 1)) {
      const p = values.reduce<number>((a, b) => a + b, 0) / values.length;
      return designEffectWilson(values, clusters, p, g);
    }
  }
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

/**
 * The Wilson interval of a pass rate over clusters, on the effective number of runs (wilsonEffective of
 * @agent-nexus/driftbench-stats). The variance of the pooled rate is the ratio estimator over clusters,
 * g / (g - 1) sum (y_c - p n_c)^2 / N^2, with y_c the passes and n_c the runs of cluster c; the effective runs are
 * p (1 - p) / variance, kept within 1 to N (the design effect is N over that). The quantile is the Student t on
 * g - 1 degrees of freedom, so a handful of clusters widens the interval where a normal quantile would not.
 */
function designEffectWilson(
  values: readonly number[],
  clusters: readonly (string | number)[],
  p: number,
  g: number,
): Estimate {
  const counts = new Map<string | number, { n: number; k: number }>();
  values.forEach((v, i) => {
    const key = clusters[i] as string | number;
    const cluster = counts.get(key) ?? { n: 0, k: 0 };
    cluster.n += 1;
    cluster.k += v;
    counts.set(key, cluster);
  });
  const w = wilsonEffective([...counts.values()], { quantile: 't' });
  return {
    estimate: p,
    lower: w.lower,
    upper: w.upper,
    method: 'wilson, design effect',
    n: values.length,
    clusters: g,
    designEffect: w.designEffect,
    effectiveN: w.effectiveN,
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
