/** Mixture weights by expectation-maximisation. */

export interface MixtureWeightsOptions {
  /** Stop when no weight moves more than this in one step. Default 1e-12. */
  readonly tolerance?: number;
  /** Stop after this many steps. Default 100000. */
  readonly maxIterations?: number;
}

export interface MixtureWeightsResult {
  readonly weights: number[];
  readonly iterations: number;
  readonly logLikelihood: number;
}

/** Row sums must equal 1 within this. */
const ROW_TOLERANCE = 1e-12;

/**
 * The maximum-likelihood weights of a mixture of known category distributions. `components` holds m
 * probability vectors over the same c categories; `counts` holds c counts. The weights maximise
 * sum_i counts_i log(sum_j w_j components_j_i), found by expectation-maximisation from equal weights. A
 * category with a count that no component can produce is refused; a category with count 0 takes no part.
 */
export function mixtureWeights(
  components: readonly (readonly number[])[],
  counts: readonly number[],
  options: MixtureWeightsOptions = {},
): MixtureWeightsResult {
  const fn = 'mixtureWeights';
  const m = components.length;
  const c = counts.length;
  if (m === 0) throw new RangeError(`${fn}: components must hold at least one component`);
  components.forEach((row, j) => {
    if (row.length !== c)
      throw new RangeError(`${fn}: component ${j} has ${row.length} entries, counts has ${c}`);
    let sum = 0;
    row.forEach((p, i) => {
      if (!(p >= 0 && p <= 1))
        throw new RangeError(`${fn}: component ${j}[${i}] must lie in [0, 1], got ${p}`);
      sum += p;
    });
    if (!(Math.abs(sum - 1) <= ROW_TOLERANCE))
      throw new RangeError(`${fn}: component ${j} must sum to 1, got ${sum}`);
  });
  let total = 0;
  counts.forEach((n, i) => {
    if (!Number.isSafeInteger(n) || n < 0)
      throw new RangeError(`${fn}: counts[${i}] must be a non-negative integer, got ${n}`);
    total += n;
  });
  if (total === 0) throw new RangeError(`${fn}: counts must not all be 0`);
  const tolerance = options.tolerance ?? 1e-12;
  const maxIterations = options.maxIterations ?? 100000;
  const used: number[] = [];
  counts.forEach((n, i) => {
    if (n === 0) return;
    if (components.every((row) => (row[i] as number) === 0))
      throw new RangeError(`${fn}: counts[${i}] is ${n} but no component can produce category ${i}`);
    used.push(i);
  });
  const prob = (j: number, i: number): number => (components[j] as readonly number[])[i] as number;
  const mixAt = (w: readonly number[], i: number): number => {
    let mix = 0;
    for (let j = 0; j < m; j += 1) mix += (w[j] as number) * prob(j, i);
    return mix;
  };
  let weights = new Array<number>(m).fill(1 / m);
  let iterations = 0;
  while (iterations < maxIterations) {
    iterations += 1;
    const next = new Array<number>(m).fill(0);
    for (const i of used) {
      const mix = mixAt(weights, i);
      const n = counts[i] as number;
      for (let j = 0; j < m; j += 1)
        next[j] = (next[j] as number) + (n * (weights[j] as number) * prob(j, i)) / mix;
    }
    let moved = 0;
    for (let j = 0; j < m; j += 1) {
      next[j] = (next[j] as number) / total;
      moved = Math.max(moved, Math.abs((next[j] as number) - (weights[j] as number)));
    }
    weights = next;
    if (moved <= tolerance) break;
  }
  let logLikelihood = 0;
  for (const i of used) logLikelihood += (counts[i] as number) * Math.log(mixAt(weights, i));
  return { weights, iterations, logLikelihood };
}
