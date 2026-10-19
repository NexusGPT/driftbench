/** Mixture weights: the maximum-likelihood weights of a mixture of known category distributions. */

export interface MixtureWeightsOptions {
  /** Stop when no weight moves more than this between two rounds; defaults to 1e-12. */
  readonly tolerance?: number;
  /** The most rounds of expectation-maximisation; defaults to 100000. */
  readonly maxIterations?: number;
}

export interface MixtureWeightsResult {
  readonly weights: number[];
  readonly iterations: number;
  readonly logLikelihood: number;
}

/**
 * The weights w (non-negative, summing to 1) of the m components that maximise the multinomial
 * log-likelihood sum_i counts_i log(sum_j w_j components_j_i), by expectation-maximisation from equal
 * weights. When the observed shares are a mix of linearly independent components, the result is that mix.
 */
export function mixtureWeights(
  components: readonly (readonly number[])[],
  counts: readonly number[],
  options: MixtureWeightsOptions = {},
): MixtureWeightsResult {
  const m = components.length;
  if (m === 0) throw new RangeError('mixtureWeights: components must not be empty');
  const c = counts.length;
  if (c === 0) throw new RangeError('mixtureWeights: counts must not be empty');
  components.forEach((row, j) => {
    if (row.length !== c)
      throw new RangeError(`mixtureWeights: component ${j} has ${row.length} entries, counts has ${c}`);
    let total = 0;
    row.forEach((p, i) => {
      if (!Number.isFinite(p) || p < 0 || p > 1)
        throw new RangeError(`mixtureWeights: component ${j} entry ${i} must be in [0, 1], got ${p}`);
      total += p;
    });
    if (Math.abs(total - 1) > 1e-12)
      throw new RangeError(`mixtureWeights: component ${j} sums to ${total}, not 1`);
  });
  let n = 0;
  counts.forEach((k, i) => {
    if (!Number.isSafeInteger(k) || k < 0)
      throw new RangeError(`mixtureWeights: count ${i} must be a non-negative integer, got ${k}`);
    n += k;
  });
  if (n === 0) throw new RangeError('mixtureWeights: counts must not all be 0');
  const tolerance = options.tolerance ?? 1e-12;
  if (!(tolerance > 0) || !Number.isFinite(tolerance))
    throw new RangeError(`mixtureWeights: tolerance must be above 0, got ${tolerance}`);
  const maxIterations = options.maxIterations ?? 100000;
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1)
    throw new RangeError(`mixtureWeights: maxIterations must be a positive integer, got ${maxIterations}`);

  let weights = new Array<number>(m).fill(1 / m);
  let iterations = 0;
  while (iterations < maxIterations) {
    iterations += 1;
    const next = new Array<number>(m).fill(0);
    for (let i = 0; i < c; i += 1) {
      const k = counts[i] as number;
      if (k === 0) continue;
      let mix = 0;
      for (let j = 0; j < m; j += 1)
        mix += (weights[j] as number) * ((components[j] as number[])[i] as number);
      if (mix === 0) continue;
      for (let j = 0; j < m; j += 1)
        next[j] =
          (next[j] as number) +
          (k * (weights[j] as number) * ((components[j] as number[])[i] as number)) / mix;
    }
    let moved = 0;
    for (let j = 0; j < m; j += 1) {
      next[j] = (next[j] as number) / n;
      moved = Math.max(moved, Math.abs((next[j] as number) - (weights[j] as number)));
    }
    weights = next;
    if (moved <= tolerance) break;
  }
  let logLikelihood = 0;
  for (let i = 0; i < c; i += 1) {
    const k = counts[i] as number;
    if (k === 0) continue;
    let mix = 0;
    for (let j = 0; j < m; j += 1) mix += (weights[j] as number) * ((components[j] as number[])[i] as number);
    logLikelihood += k * Math.log(mix);
  }
  return { weights, iterations, logLikelihood };
}
