/** Exact tests on counts: the hypergeometric probability and the sign test. */

import { binomialCdf, logGamma } from './special';

/** Up to this many factors, ln C(a, b) is summed term by term; above it, from ln Gamma. */
const LOG_CHOOSE_LOOP = 5000;

/** ln C(a, b) for whole numbers 0 <= b <= a, as a sum of logarithms of ratios so that no large factorial forms. */
function logChoose(a: number, b: number): number {
  const m = Math.min(b, a - b);
  if (m > LOG_CHOOSE_LOOP) return logGamma(a + 1) - logGamma(m + 1) - logGamma(a - m + 1);
  let sum = 0;
  for (let i = 1; i <= m; i += 1) sum += Math.log((a - m + i) / i);
  return sum;
}

function assertWhole(fn: string, name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${fn}: ${name} must be a non-negative integer, got ${value}`);
}

/**
 * The probability of exactly k marked objects among n objects drawn without replacement from N objects of which
 * K are marked: C(K, k) C(N - K, n - k) / C(N, n). It is 0 when k lies outside the possible range.
 */
export function hypergeometricPmf(k: number, N: number, K: number, n: number): number {
  const fn = 'hypergeometricPmf';
  assertWhole(fn, 'k', k);
  assertWhole(fn, 'N', N);
  assertWhole(fn, 'K', K);
  assertWhole(fn, 'n', n);
  if (K > N) throw new RangeError(`${fn}: K (${K}) exceeds N (${N})`);
  if (n > N) throw new RangeError(`${fn}: n (${n}) exceeds N (${N})`);
  if (k > K || k > n || n - k > N - K) return 0;
  return Math.exp(logChoose(K, k) + logChoose(N - K, n - k) - logChoose(N, n));
}

/**
 * The two-sided exact sign test: with n = positives + negatives signs, each positive with chance 0.5, the result
 * is min(1, 2 S / 2^n), S the number of sign patterns with at most min(positives, negatives) of the rarer sign.
 * The caller removes the zero differences.
 */
export function signTestExact(positives: number, negatives: number): number {
  const fn = 'signTestExact';
  assertWhole(fn, 'positives', positives);
  assertWhole(fn, 'negatives', negatives);
  const n = positives + negatives;
  if (n === 0) throw new RangeError(`${fn}: positives + negatives must be at least 1`);
  return Math.min(1, 2 * binomialCdf(Math.min(positives, negatives), n, 0.5));
}
