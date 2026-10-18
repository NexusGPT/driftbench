/**
 * Where the spread comes from: nested variance components, the intraclass correlation per level,
 * Neyman allocation of a fixed pool across strata, and the repeats per block for a noise floor.
 */

import { assertProbability } from './basics';
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
  if (N === 0) throw new RangeError('varianceComponents: observations is empty');
  const ys = observations.map((o) => (typeof o.value === 'boolean' ? (o.value ? 1 : 0) : o.value));
  observations.forEach((o, i) => {
    if (o.path.length !== L) {
      throw new RangeError(
        `varianceComponents: observation ${i} has ${o.path.length} path entries, expected ${L}`,
      );
    }
    if (!Number.isFinite(ys[i] as number))
      throw new RangeError(`varianceComponents: observation ${i} is not finite`);
  });

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

  return { method: 'anova', balanced, n: N, mean: (sums[0]?.get('') as number) / N, components, total };
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
  /** Integers summing to total, by largest remainder. */
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
  const allocated = exact.map(Math.floor);
  let left = total - allocated.reduce((s, v) => s + v, 0);
  const order = exact
    .map((e, i) => [e - Math.floor(e), i] as const)
    .sort((p, q) => q[0] - p[0] || p[1] - q[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    allocated[i] = (allocated[i] as number) + 1;
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
    assertProbability('flipRate', input.flipRate);
    variance = input.flipRate * (1 - input.flipRate);
  } else throw new RangeError('repeatsForFloor: give variance or flipRate');
  if (!(variance >= 0)) throw new RangeError('repeatsForFloor: variance must be non-negative');
  if (!(input.floor > 0)) throw new RangeError('repeatsForFloor: floor must be positive');
  if (!(blocks >= 1)) throw new RangeError('repeatsForFloor: blocks must be at least 1');
  const exact = (factor * z * z * variance) / (blocks * input.floor * input.floor);
  const rounded = Math.round(exact);
  const repeats = Math.max(1, Math.abs(exact - rounded) < 1e-9 ? rounded : Math.ceil(exact));
  return { repeats, floor: z * Math.sqrt((factor * variance) / (repeats * blocks)) };
}
