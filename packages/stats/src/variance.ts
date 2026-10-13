/**
 * Where the spread comes from: nested variance components, the intraclass correlation per level,
 * Neyman allocation of a fixed pool across strata, and the repeats per block for a noise floor.
 */

import { assertFinite, assertProbability } from './basics';
import { Z95 } from './intervals';

export interface Observation {
  /** The outcome: a pass flag (true counts as 1) or a continuous score. */
  readonly value: number | boolean;
  /**
   * The group at each named level, outermost first: for the default levels
   * [cell, conversation, wording]. A group is identified by its whole prefix, so conversation ids may
   * repeat across cells. Each observation is one repeat (the residual level).
   */
  readonly path: readonly string[];
}

export interface VarianceComponentsOptions {
  /** Names of the nested levels, outermost first. Default ['cell', 'conversation', 'wording']. */
  readonly levels?: readonly string[];
  /** Name of the residual level. Default 'repeat'. */
  readonly residual?: string;
}

export interface Component {
  readonly level: string;
  /** Number of groups at this level (observations for the residual). */
  readonly groups: number;
  readonly df: number;
  readonly sumSquares: number;
  /** Sum of squares over df, NaN when df is 0. */
  readonly meanSquare: number;
  /** The ANOVA estimate as solved, possibly negative. */
  readonly estimate: number;
  /** The estimate truncated at 0, the value used for shares. */
  readonly variance: number;
  /** variance over the total of the truncated variances. */
  readonly share: number;
  /** False when the level has no degrees of freedom (one child per parent), so its variance is not identified. */
  readonly estimable: boolean;
}

export interface VarianceComponentsResult {
  /** 'anova': classic nested ANOVA when balanced; Henderson's method I (same sums of squares, expected mean square coefficients from the group sizes) otherwise. */
  readonly method: 'anova';
  readonly balanced: boolean;
  readonly n: number;
  readonly mean: number;
  /** One entry per named level, outermost first, then the residual. */
  readonly components: readonly Component[];
  readonly total: number;
}

const SEP = '\u0000';

/**
 * Nested random-effects variance components by the ANOVA (method of moments) estimator, for binary or
 * continuous outcomes. Model: y = mu + a(cell) + b(conversation in cell) + c(wording in conversation) + e.
 *
 * For level l with groups g of size n_g and parents p at level l - 1:
 * SS_l = sum_g n_g ybar_g^2 - sum_p n_p ybar_p^2, df_l = G_l - G_(l-1), and
 * E[MS_l] = s2_e + sum over levels j at or below l of k_lj s2_j, where
 * k_lj df_l = T(l, j) - T(l - 1, j) and T(l, j) = sum over groups g at level l of
 * (sum over groups h at level j inside g of n_h^2) / n_g. The system is solved from the innermost level out.
 * For balanced data this is the classic nested ANOVA: s2_wording = (MS_w - MS_e) / r, and so on.
 * For unbalanced data it is Henderson's method I. Negative estimates are reported and truncated at 0.
 * A binary outcome is analysed as 0/1 (the linear ANOVA estimator of the intraclass correlation).
 */
export function varianceComponents(
  observations: readonly Observation[],
  options: VarianceComponentsOptions = {},
): VarianceComponentsResult {
  const levels = options.levels ?? ['cell', 'conversation', 'wording'];
  const residual = options.residual ?? 'repeat';
  const L = levels.length;
  const N = observations.length;
  if (N === 0) throw new RangeError('varianceComponents: observations must not be empty');
  const raw = observations.map((o) => (typeof o.value === 'boolean' ? (o.value ? 1 : 0) : o.value));
  observations.forEach((o, i) => {
    if (o.path.length !== L) {
      throw new RangeError(
        `varianceComponents: observations[${i}].path has ${o.path.length} entries, expected ${L}`,
      );
    }
    if (!Number.isFinite(raw[i] as number))
      throw new RangeError(`varianceComponents: observations[${i}].value must be finite, got ${raw[i]}`);
  });

  // Shift by the first value: the variances do not depend on the shift, the differences of nearby values are exact,
  // so a large common offset costs no digits and equal values give exact zeros (a grand mean would not).
  const center = raw[0] as number;
  const ys = raw.map((y) => y - center);

  // Group sizes and sums per level; level 0 is the grand group.
  const sizes: Map<string, number>[] = [];
  const sums: Map<string, number>[] = [];
  for (let l = 0; l <= L; l += 1) {
    const size = new Map<string, number>();
    const total = new Map<string, number>();
    observations.forEach((o, i) => {
      const key = o.path.slice(0, l).join(SEP);
      size.set(key, (size.get(key) ?? 0) + 1);
      total.set(key, (total.get(key) ?? 0) + (ys[i] as number));
    });
    sizes.push(size);
    sums.push(total);
  }
  const groupCount = sizes.map((m) => m.size);
  // sum_g n_g ybar_g^2 = sum_g S_g^2 / n_g.
  const between = sums.map((total, l) => {
    let s = 0;
    for (const [key, t] of total) s += (t * t) / (sizes[l]?.get(key) as number);
    return s;
  });
  const sumSq = ys.reduce((s, y) => s + y * y, 0);

  // T(l, j) for 0 <= l <= j <= L.
  const T: number[][] = Array.from({ length: L + 1 }, () => new Array<number>(L + 1).fill(N));
  for (let j = 1; j <= L; j += 1) {
    for (let l = 0; l <= j; l += 1) {
      const acc = new Map<string, number>();
      for (const [key, nh] of sizes[j] as Map<string, number>) {
        const ancestor = key.split(SEP).slice(0, l).join(SEP);
        acc.set(ancestor, (acc.get(ancestor) ?? 0) + nh * nh);
      }
      let t = 0;
      for (const [ancestor, sq] of acc) t += sq / ((sizes[l] as Map<string, number>).get(ancestor) as number);
      (T[l] as number[])[j] = t;
    }
  }

  const df: number[] = [];
  const ss: number[] = [];
  for (let l = 1; l <= L; l += 1) {
    df.push((groupCount[l] as number) - (groupCount[l - 1] as number));
    ss.push((between[l] as number) - (between[l - 1] as number));
  }
  const dfE = N - (groupCount[L] as number);
  const ssE = sumSq - (between[L] as number);
  const msE = dfE > 0 ? ssE / dfE : Number.NaN;
  const sigmaE = dfE > 0 ? msE : 0;

  // Solve from the innermost level out.
  const estimates = new Array<number>(L).fill(0);
  const estimable = new Array<boolean>(L).fill(false);
  const ms = new Array<number>(L).fill(Number.NaN);
  for (let l = L; l >= 1; l -= 1) {
    const d = df[l - 1] as number;
    if (d <= 0) continue;
    ms[l - 1] = (ss[l - 1] as number) / d;
    const coef = (j: number): number =>
      (((T[l] as number[])[j] as number) - ((T[l - 1] as number[])[j] as number)) / d;
    let rest = ms[l - 1] as number;
    rest -= sigmaE;
    for (let j = l + 1; j <= L; j += 1) rest -= coef(j) * (estimates[j - 1] as number);
    const own = coef(l);
    if (own <= 0) continue;
    estimates[l - 1] = rest / own;
    estimable[l - 1] = true;
  }

  const truncated = estimates.map((e) => Math.max(0, e));
  const residualVariance = Math.max(0, sigmaE);
  const total = truncated.reduce((s, v) => s + v, 0) + residualVariance;
  const share = (v: number): number => (total > 0 ? v / total : 0);
  const components: Component[] = levels.map((level, i) => ({
    level,
    groups: groupCount[i + 1] as number,
    df: df[i] as number,
    sumSquares: ss[i] as number,
    meanSquare: ms[i] as number,
    estimate: estimates[i] as number,
    variance: truncated[i] as number,
    share: share(truncated[i] as number),
    estimable: estimable[i] as boolean,
  }));
  components.push({
    level: residual,
    groups: N,
    df: dfE,
    sumSquares: ssE,
    meanSquare: msE,
    estimate: sigmaE,
    variance: residualVariance,
    share: share(residualVariance),
    estimable: dfE > 0,
  });

  let balanced = true;
  for (let l = 1; l <= L && balanced; l += 1) {
    const set = new Set((sizes[l] as Map<string, number>).values());
    if (set.size > 1) balanced = false;
  }
  // Equal leaf sizes are not enough: every parent must also hold the same number of children.
  for (let l = 1; l <= L && balanced; l += 1) {
    const children = new Map<string, number>();
    for (const key of (sizes[l] as Map<string, number>).keys()) {
      const parent = key
        .split(SEP)
        .slice(0, l - 1)
        .join(SEP);
      children.set(parent, (children.get(parent) ?? 0) + 1);
    }
    if (new Set(children.values()).size > 1) balanced = false;
  }

  return {
    method: 'anova',
    balanced,
    n: N,
    mean: center + (sums[0]?.get('') as number) / N,
    components,
    total,
  };
}

/**
 * ICC(1) from the one-way ANOVA of values grouped by cluster, unbalanced: (MSB - MSW) / (MSB + (n0 - 1) MSW)
 * with n0 = (N - sum n_g^2 / N) / (k - 1) (Shrout and Fleiss 1979; Donner 1986). It is not truncated at zero:
 * a negative value says the clusters differ less than chance. Throws a RangeError on no values, mismatched
 * lengths, a value that is not finite, fewer than two clusters, or no cluster with two values.
 */
export function iccOneWay(values: readonly number[], clusters: readonly (string | number)[]): number {
  if (values.length === 0) throw new RangeError('iccOneWay of an empty sample');
  if (values.length !== clusters.length) {
    throw new RangeError(
      `iccOneWay: values and clusters must have the same length, got ${values.length} and ${clusters.length}`,
    );
  }
  const groups = new Map<string | number, { n: number; sum: number }>();
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (!Number.isFinite(v)) throw new RangeError(`iccOneWay: values[${i}] must be finite, got ${v}`);
    const key = clusters[i] as string | number;
    const g = groups.get(key) ?? { n: 0, sum: 0 };
    g.n += 1;
    g.sum += v;
    groups.set(key, g);
    total += v;
  }
  const k = groups.size;
  const N = values.length;
  if (k < 2) throw new RangeError(`iccOneWay needs at least two clusters, got ${k}`);
  if (N === k) throw new RangeError('iccOneWay needs at least one cluster with two values');
  const grand = total / N;
  let ssb = 0;
  let sumSquaredSizes = 0;
  for (const g of groups.values()) {
    ssb += g.n * (g.sum / g.n - grand) ** 2;
    sumSquaredSizes += g.n * g.n;
  }
  let ssw = 0;
  for (let i = 0; i < N; i += 1) {
    const g = groups.get(clusters[i] as string | number) as { n: number; sum: number };
    ssw += ((values[i] as number) - g.sum / g.n) ** 2;
  }
  const msb = ssb / (k - 1);
  const msw = ssw / (N - k);
  const n0 = (N - sumSquaredSizes / N) / (k - 1);
  const denominator = msb + (n0 - 1) * msw;
  if (!(denominator > 0))
    throw new RangeError(
      'iccOneWay: the clusters and the values are all equal, so the correlation is undefined',
    );
  return (msb - msw) / denominator;
}

/**
 * The design effect measured from the data: 1 + (mbar - 1) ICC(1), mbar the mean cluster size and ICC(1) as
 * `iccOneWay` (Kish 1965). Throws what `iccOneWay` throws.
 */
export function designEffectFromData(
  values: readonly number[],
  clusters: readonly (string | number)[],
): number {
  const rho = iccOneWay(values, clusters);
  const mbar = values.length / new Set(clusters).size;
  return 1 + (mbar - 1) * rho;
}

export interface LevelCorrelation {
  readonly level: string;
  /**
   * The correlation between two observations that share the group at this level (and so every
   * level above it): the sum of the variances at this level and above, over the total.
   */
  readonly icc: number;
  /** This level's own share of the total variance. */
  readonly share: number;
}

/** The intraclass correlation per named level, outermost first, from a varianceComponents result. */
export function icc(result: VarianceComponentsResult): LevelCorrelation[] {
  const named = result.components.slice(0, -1);
  let cumulative = 0;
  return named.map((c) => {
    cumulative += c.variance;
    return { level: c.level, icc: result.total > 0 ? cumulative / result.total : 0, share: c.share };
  });
}

export interface NeymanInput {
  /** Population size (or weight) per stratum, N_h. */
  readonly sizes: readonly number[];
  /** Standard deviation of the outcome per stratum, S_h. */
  readonly sds: readonly number[];
  /** Total sample to allocate. */
  readonly total: number;
}

export interface NeymanResult {
  /** total N_h S_h / sum(N_h S_h), unrounded. */
  readonly exact: readonly number[];
  /**
   * Integers summing to total that minimise sum (N_h S_h)^2 / n_h, the stratified variance: the best
   * whole-number Neyman allocation, which rounding `exact` does not always reach.
   */
  readonly allocated: readonly number[];
}

/**
 * Neyman allocation of a fixed sample across strata: n_h proportional to N_h S_h, so a stratum with
 * more spread gets more conversations. When every S_h is 0 it falls back to proportional allocation.
 */
export function neymanAllocation(input: NeymanInput): NeymanResult {
  const { sizes, sds, total } = input;
  if (sizes.length !== sds.length || sizes.length === 0) {
    throw new RangeError('neymanAllocation: sizes and sds must be non-empty and the same length');
  }
  if (!Number.isInteger(total) || total < 0)
    throw new RangeError(`neymanAllocation: total must be a non-negative integer, got ${total}`);
  sizes.forEach((v, i) => {
    if (!Number.isFinite(v)) throw new RangeError(`neymanAllocation: sizes[${i}] must be finite, got ${v}`);
    if (!(v >= 0)) throw new RangeError(`neymanAllocation: sizes[${i}] must be non-negative`);
  });
  sds.forEach((v, i) => {
    if (!(v >= 0)) throw new RangeError(`neymanAllocation: sds[${i}] must be non-negative`);
  });
  let weights = sizes.map((nh, i) => nh * (sds[i] as number));
  if (weights.every((w) => w === 0)) weights = [...sizes];
  const sumW = weights.reduce((s, w) => s + w, 0);
  if (sumW === 0) throw new RangeError('neymanAllocation: every stratum has size 0');
  const exact = weights.map((w) => (total * w) / sumW);
  const allocated = weights.map(() => 0);
  // Every stratum with weight needs one conversation before its variance is finite. With fewer than
  // that, the largest weights get one each (ties to the lower index).
  const positive = weights
    .map((w, i) => [w, i] as const)
    .filter(([w]) => w > 0)
    .sort((p, q) => q[0] - p[0] || p[1] - q[1]);
  for (const [, i] of positive.slice(0, total)) allocated[i] = 1;
  let left = total - Math.min(total, positive.length);
  // The objective is separable and convex in n_h, so adding one at a time where it removes the most
  // variance, w^2 / (n (n + 1)), reaches the integer optimum. Ties go to the lower index.
  // A binary heap keeps the largest gain on top (ties to the lower index), so each unit costs O(log strata).
  const gainOf = (i: number, w: number): number => {
    const n = allocated[i] as number;
    return (w * w) / (n * (n + 1));
  };
  const heap = positive.map(([w, i]) => ({ i, gain: gainOf(i, w), w }));
  const before = (x: (typeof heap)[number], y: (typeof heap)[number]): boolean =>
    x.gain > y.gain || (x.gain === y.gain && x.i < y.i);
  const siftDown = (start: number): void => {
    let k = start;
    for (;;) {
      const l = 2 * k + 1;
      const r = l + 1;
      let top = k;
      if (l < heap.length && before(heap[l] as (typeof heap)[number], heap[top] as (typeof heap)[number]))
        top = l;
      if (r < heap.length && before(heap[r] as (typeof heap)[number], heap[top] as (typeof heap)[number]))
        top = r;
      if (top === k) return;
      [heap[k], heap[top]] = [heap[top] as (typeof heap)[number], heap[k] as (typeof heap)[number]];
      k = top;
    }
  };
  for (let k = Math.floor(heap.length / 2) - 1; k >= 0; k -= 1) siftDown(k);
  while (left > 0 && heap.length > 0) {
    const top = heap[0] as (typeof heap)[number];
    allocated[top.i] = (allocated[top.i] as number) + 1;
    top.gain = gainOf(top.i, top.w);
    siftDown(0);
    left -= 1;
  }
  return { exact, allocated };
}

export interface RepeatsForFloorInput {
  /** Run-to-run variance of one block's outcome. Give this or flipRate. */
  readonly variance?: number;
  /** Run-to-run flip rate p of a pass flag; the variance is p (1 - p). */
  readonly flipRate?: number;
  /** The target noise floor: the half-width under which a difference is read as noise. */
  readonly floor: number;
  /** z of the floor. Default 1.96 (95 percent, two-sided). */
  readonly z?: number;
  /** Blocks averaged into the compared figure. Default 1. */
  readonly blocks?: number;
  /** True (default) when the floor is on a difference between two versions, doubling the variance. */
  readonly difference?: boolean;
}

export interface RepeatsForFloorResult {
  readonly repeats: number;
  /** The floor reached with that many repeats. */
  readonly floor: number;
}

/**
 * Repeats per block so that run-to-run noise stays under a floor: the half-width
 * z sqrt(f variance / (r blocks)) with f = 2 for a difference between two versions and 1 otherwise,
 * so r = ceil(f z^2 variance / (blocks floor^2)), at least 1.
 */
export function repeatsForFloor(input: RepeatsForFloorInput): RepeatsForFloorResult {
  const z = input.z ?? Z95;
  const blocks = input.blocks ?? 1;
  const factor = (input.difference ?? true) ? 2 : 1;
  let variance: number;
  if (input.variance !== undefined) variance = input.variance;
  else if (input.flipRate !== undefined) {
    assertProbability('repeatsForFloor', 'flipRate', input.flipRate);
    variance = input.flipRate * (1 - input.flipRate);
  } else throw new RangeError('repeatsForFloor: give variance or flipRate');
  assertFinite('repeatsForFloor', 'variance', variance);
  assertFinite('repeatsForFloor', 'blocks', blocks);
  if (!(variance >= 0)) throw new RangeError('repeatsForFloor: variance must be non-negative');
  if (!(input.floor > 0)) throw new RangeError('repeatsForFloor: floor must be positive');
  if (!(blocks >= 1)) throw new RangeError('repeatsForFloor: blocks must be at least 1');
  const exact = (factor * z * z * variance) / (blocks * input.floor * input.floor);
  const rounded = Math.round(exact);
  const repeats = Math.max(1, Math.abs(exact - rounded) < 1e-9 ? rounded : Math.ceil(exact));
  return { repeats, floor: z * Math.sqrt((factor * variance) / (repeats * blocks)) };
}

export interface StratifiedMeanInput {
  /** The sample mean of each stratum. */
  readonly means: readonly number[];
  /** The population size N_h of each stratum. */
  readonly sizes: readonly number[];
  /** The sample standard deviation s_h of each stratum. */
  readonly sds: readonly number[];
  /** The sample size n_h of each stratum. */
  readonly samples: readonly number[];
}

/**
 * The stratified estimator of a mean (Cochran, Sampling Techniques, 5.4): sum W_h ybar_h with W_h = N_h / N,
 * and variance sum W_h^2 (1 - n_h / N_h) s_h^2 / n_h, the finite population correction included. Throws a
 * RangeError on no strata, arrays of different lengths, a mean or sd that is not finite, an sd below zero, a
 * size below one, or a sample that is not a whole number from 1 to its stratum size.
 */
export function stratifiedMean(input: StratifiedMeanInput): { estimate: number; variance: number } {
  const { means, sizes, sds, samples } = input;
  const H = means.length;
  if (H === 0) throw new RangeError('stratifiedMean of no strata');
  if (sizes.length !== H || sds.length !== H || samples.length !== H) {
    throw new RangeError(
      `stratifiedMean: means, sizes, sds and samples must have the same length, got ${H}, ${sizes.length}, ${sds.length} and ${samples.length}`,
    );
  }
  let population = 0;
  for (let h = 0; h < H; h += 1) {
    const N = sizes[h] as number;
    const n = samples[h] as number;
    if (!Number.isFinite(means[h] as number)) {
      throw new RangeError(`stratifiedMean: means[${h}] must be finite, got ${means[h]}`);
    }
    if (!Number.isFinite(sds[h] as number) || (sds[h] as number) < 0) {
      throw new RangeError(`stratifiedMean: sds[${h}] must be finite and not negative, got ${sds[h]}`);
    }
    if (!Number.isFinite(N) || N < 1) {
      throw new RangeError(`stratifiedMean: sizes[${h}] must be at least 1, got ${N}`);
    }
    if (!Number.isInteger(n) || n < 1 || n > N) {
      throw new RangeError(
        `stratifiedMean: samples[${h}] must be a whole number from 1 to sizes[${h}] (${N}), got ${n}`,
      );
    }
    population += N;
  }
  let estimate = 0;
  let variance = 0;
  for (let h = 0; h < H; h += 1) {
    const W = (sizes[h] as number) / population;
    const n = samples[h] as number;
    estimate += W * (means[h] as number);
    variance += (W * W * (1 - n / (sizes[h] as number)) * (sds[h] as number) ** 2) / n;
  }
  return { estimate, variance };
}
