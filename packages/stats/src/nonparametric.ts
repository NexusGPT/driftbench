/** Exact nonparametric tests. */

import { assertFiniteValues } from './basics';

/** The largest sample the exact count enumerates. */
const MAX_PAIRS = 30;

/**
 * The exact two-sided p-value of the Wilcoxon signed-rank test. The differences have no zero and no two equal
 * absolute values. With W+ the sum of the ranks (1 for the smallest absolute value) of the positive differences,
 * the result is min(1, 2 * #{sign patterns with T <= min(W+, W-)} / 2^n), counted by dynamic programming.
 */
export function wilcoxonSignedRankExactP(diffs: readonly number[]): number {
  const fn = 'wilcoxonSignedRankExactP';
  const n = diffs.length;
  if (n === 0) throw new RangeError(`${fn}: diffs must not be empty`);
  if (n > MAX_PAIRS)
    throw new RangeError(`${fn}: diffs holds ${n} values, at most ${MAX_PAIRS} are enumerated`);
  assertFiniteValues(fn, 'diffs', diffs);
  const ranked = diffs
    .map((d, i) => {
      if (d === 0) throw new RangeError(`${fn}: diffs[${i}] must not be 0`);
      return { size: Math.abs(d), positive: d > 0 };
    })
    .sort((a, b) => a.size - b.size);
  let plus = 0;
  ranked.forEach((entry, i) => {
    if (i > 0 && entry.size === (ranked[i - 1] as { size: number }).size)
      throw new RangeError(`${fn}: two differences have the same absolute value ${entry.size}`);
    if (entry.positive) plus += i + 1;
  });
  const total = (n * (n + 1)) / 2;
  const smaller = Math.min(plus, total - plus);
  // counts[s]: the number of subsets of the ranks 1..n with sum s.
  const counts = new Array<number>(total + 1).fill(0);
  counts[0] = 1;
  for (let rank = 1; rank <= n; rank += 1) {
    for (let s = total; s >= rank; s -= 1) counts[s] = (counts[s] as number) + (counts[s - rank] as number);
  }
  let tail = 0;
  for (let s = 0; s <= smaller; s += 1) tail += counts[s] as number;
  return Math.min(1, (2 * tail) / 2 ** n);
}
