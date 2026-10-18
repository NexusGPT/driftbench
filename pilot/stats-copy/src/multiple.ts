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
