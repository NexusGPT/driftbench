/**
 * The estimators behind the coverage and completeness reports, as pure functions. Source numbers (S2,
 * S24...) refer to the statistics dossier of the test generation design (2026-10-11).
 *
 * Every estimator here assumes the sampling unit is the conversation: units are independent, and they
 * come from a generator that does not learn from earlier results. A generator that steers toward what it
 * has not seen breaks the second assumption and makes every estimate optimistic (STADS, Bohme 2018, S2,
 * sections 6.5.3 and 9.5; adaptive bias, Bohme, Liyanage and Wustholz 2021, S42).
 */

/**
 * Good-Turing discovery probability, U = f1 / n: f1 is the number of cells seen in exactly one
 * conversation, n the number of conversations (STADS, S2, equation 6; Good-Turing estimation, S9). It
 * reads as the chance that the next conversation shows a cell no earlier conversation showed. When one
 * conversation can show several cells (the Bernoulli product model of STADS, section 7), f1 / n estimates
 * the expected number of cells the next conversation shows for the first time, and the chance of at least
 * one is no larger than that expectation (Markov's inequality; derived here).
 *
 * Requires 0 <= f1 <= n and n >= 1. The completeness line prints it only with at least as many
 * conversations as cells, which keeps f1 <= n.
 */
export function goodTuringDiscovery(f1: number, n: number): number {
  checkCounts(f1, 0, n);
  return f1 / n;
}

/**
 * Sample coverage in the Chao form (Chao, Gotelli, Hsieh, Sander, Ma, Colwell and Ellison 2014, S24):
 *
 *   C = 1 - (f1 / n) * [ (n - 1) f1 / ((n - 1) f1 + 2 f2) ]
 *
 * f1 and f2 count the cells seen in exactly one and exactly two conversations, n counts the conversations.
 * It is the complement of the discovery probability times a correction that shrinks as f2 grows: the more
 * cells seen exactly twice, the higher the coverage. With f1 = 0 the coverage is 1; with n = 1 (so f2 = 0)
 * the correction is 1.
 *
 * n is the number of conversations here, so C pairs with the discovery probability above. A form with the
 * total number of incidences in place of n is also used for incidence data; every counted conversation
 * shows at least one cell, so that total is at least n and the form used here never gives the higher
 * coverage (derived here).
 *
 * Requires 0 <= f1 <= n, f2 >= 0 and n >= 1.
 */
export function chaoCoverage(f1: number, f2: number, n: number): number {
  checkCounts(f1, f2, n);
  if (f1 === 0) return 1;
  const denominator = (n - 1) * f1 + 2 * f2;
  const correction = denominator > 0 ? ((n - 1) * f1) / denominator : 1;
  return 1 - (f1 / n) * correction;
}

export type HillNumbers = { q0: number; q1: number; q2: number };

/**
 * Hill numbers over the cells seen, from their counts (Diversity index, S31; reporting pattern of Chao
 * et al. 2014, S24): with p the share of each cell in the counts, D_q = (sum of p^q)^(1 / (1 - q)).
 * q = 0 is the number of cells seen, q = 1 the exponential of the Shannon entropy, q = 2 the inverse of
 * the Simpson index. A larger q weighs common cells more; q0 far above q2 means a few cells dominate.
 * These are the observed (plug-in) values: they describe the sample and extrapolate nothing.
 */
export function hillNumbers(counts: ArrayLike<number>): HillNumbers {
  let total = 0;
  for (let index = 0; index < counts.length; index += 1) total += counts[index] ?? 0;
  if (total === 0) return { q0: 0, q1: 0, q2: 0 };
  let q0 = 0;
  let entropy = 0;
  let simpson = 0;
  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index] ?? 0;
    if (count <= 0) continue;
    const share = count / total;
    q0 += 1;
    entropy -= share * Math.log(share);
    simpson += share * share;
  }
  return { q0, q1: Math.exp(entropy), q2: 1 / simpson };
}

/**
 * Effective sample size of weighted units, n_e = (sum of w)^2 / (sum of w^2) (Owen, Monte Carlo theory,
 * methods and examples, chapter 9, equation 9.13, S43). It equals the number of units when every weight is
 * the same, and falls toward 1 when one unit carries most of the weight; a small n_e means a reweighted
 * figure rests on few units. 0 when every weight is 0.
 */
export function effectiveSampleSize(weights: readonly number[]): number {
  let sum = 0;
  let squares = 0;
  for (const weight of weights) {
    sum += weight;
    squares += weight * weight;
  }
  return squares > 0 ? (sum * sum) / squares : 0;
}

/**
 * The q quantile of sorted values, interpolated linearly between the two closest ranks: at position
 * (length - 1) * q, counting from 0. This is the default rule of R and NumPy (type 7).
 */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new RangeError('quantile of an empty list');
  if (!(q >= 0 && q <= 1)) throw new RangeError('q must lie between 0 and 1');
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const low = sorted[below] ?? 0;
  const high = sorted[Math.ceil(position)] ?? low;
  return low + (position - below) * (high - low);
}

/** A seeded generator of numbers in [0, 1) (mulberry32): the same seed gives the same sequence. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function checkCounts(f1: number, f2: number, n: number): void {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a whole number of at least 1');
  if (!Number.isInteger(f1) || f1 < 0 || f1 > n)
    throw new RangeError('f1 must be a whole number from 0 to n');
  if (!Number.isInteger(f2) || f2 < 0) throw new RangeError('f2 must be a whole number of at least 0');
}
