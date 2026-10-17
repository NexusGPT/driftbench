/** Repeat-based reliability: pass^k, pass@k and the unreliability spread. */

import { assertCount, quantileSorted } from './basics';

function checkCounts(c: number, n: number, k: number): void {
  assertCount('c', c);
  assertCount('n', n);
  assertCount('k', k);
  if (c > n) throw new RangeError(`c (${c}) exceeds n (${n})`);
  if (k < 1 || k > n) throw new RangeError(`k must lie in [1, n], got k = ${k}, n = ${n}`);
}

/**
 * pass^k: the probability that k runs drawn without replacement from n runs, c of which passed,
 * all pass. C(c, k) / C(n, k), computed as a product so it never overflows (arXiv 2406.12045).
 */
export function passK(c: number, n: number, k: number): number {
  checkCounts(c, n, k);
  if (k > c) return 0;
  let p = 1;
  for (let i = 0; i < k; i += 1) p *= (c - i) / (n - i);
  return p;
}

/**
 * pass@k: the probability that at least one of k runs drawn without replacement passes.
 * 1 - C(n - c, k) / C(n, k), in the numerically stable product form of arXiv 2107.03374.
 */
export function passAtK(c: number, n: number, k: number): number {
  checkCounts(c, n, k);
  if (n - c < k) return 1;
  let q = 1;
  for (let i = n - c + 1; i <= n; i += 1) q *= 1 - k / i;
  return 1 - q;
}

/** Unreliability: the 90th percentile minus the 10th percentile of the scores across repeats (type 7 quantiles). */
export function unreliability(samples: readonly number[]): number {
  if (samples.length === 0) throw new RangeError('unreliability: no samples');
  const sorted = [...samples].sort((a, b) => a - b);
  return quantileSorted(sorted, 0.9) - quantileSorted(sorted, 0.1);
}
