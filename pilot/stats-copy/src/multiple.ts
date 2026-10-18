/** Multiple comparisons: Benjamini-Hochberg false discovery rate control. */

import { assertProbability } from './basics';

export interface BenjaminiHochbergResult {
  /** Adjusted p-values (q-values), in the input order. */
  readonly adjusted: readonly number[];
  /** True where the hypothesis is rejected at false discovery rate q. */
  readonly rejected: readonly boolean[];
  /** The largest raw p-value that is rejected, or null when none is. */
  readonly threshold: number | null;
  readonly q: number;
}

/**
 * The Benjamini-Hochberg step-up procedure. Sort the m p-values; reject every hypothesis up to the
 * largest rank i with p(i) <= i q / m. The adjusted p-value of rank i is min over j >= i of
 * p(j) m / j, capped at 1, as scipy.stats.false_discovery_control computes it.
 */
export function benjaminiHochberg(pvalues: readonly number[], q = 0.05): BenjaminiHochbergResult {
  assertProbability('benjaminiHochberg: q', q, true);
  pvalues.forEach((p, i) => {
    assertProbability(`benjaminiHochberg: pvalues[${i}]`, p);
  });
  const m = pvalues.length;
  if (m === 0) return { adjusted: [], rejected: [], threshold: null, q };
  const order = pvalues.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const adjusted = new Array<number>(m);
  let running = 1;
  for (let rank = m; rank >= 1; rank -= 1) {
    const [p, index] = order[rank - 1] as readonly [number, number];
    running = Math.min(running, (p * m) / rank);
    adjusted[index] = running;
  }
  let threshold: number | null = null;
  for (let rank = m; rank >= 1; rank -= 1) {
    const p = (order[rank - 1] as readonly [number, number])[0];
    if (p <= (rank * q) / m) {
      threshold = p;
      break;
    }
  }
  const rejected = pvalues.map((p) => threshold !== null && p <= threshold);
  return { adjusted, rejected, threshold, q };
}

export interface HolmResult {
  /** Holm-adjusted p-values, in the input order. */
  readonly adjusted: number[];
  /** True where the adjusted p-value is at most alpha. */
  readonly rejected: boolean[];
  readonly alpha: number;
}

/**
 * Holm's step-down procedure. With the p-values sorted ascending, the adjusted value at rank i is the
 * largest over j up to i of min(1, (m - j + 1) p(j)); it is returned in the input order. It controls the
 * chance of any false rejection. Rejected where the adjusted value is at most alpha.
 */
export function holm(pvalues: readonly number[], alpha = 0.05): HolmResult {
  assertProbability('holm: alpha', alpha, true);
  pvalues.forEach((p, i) => {
    assertProbability(`holm: pvalues[${i}]`, p);
  });
  const m = pvalues.length;
  const order = pvalues.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const adjusted = new Array<number>(m);
  let running = 0;
  order.forEach(([p, index], rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p));
    adjusted[index] = running;
  });
  return { adjusted, rejected: adjusted.map((a) => a <= alpha), alpha };
}
