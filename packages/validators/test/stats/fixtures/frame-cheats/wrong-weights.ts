import type { CoverageGroup, MixtureOptions, MixtureResult } from './honest-weights';
import { mixedStrengthCoverage as goodCoverage, mixtureWeights as goodMixture } from './honest-weights';

/** Least squares on the shares, clamped and renormalised: consistent but not maximum likelihood. */
export function leastSquaresMixture(
  components: number[][],
  counts: number[],
  _options: MixtureOptions = {},
): MixtureResult {
  goodMixture(components, counts, { maxIterations: 1 }); // argument checks only
  const m = components.length;
  const N = counts.reduce((a, b) => a + b, 0);
  const shares = counts.map((k) => k / N);
  const A = components.map((r) => components.map((r2) => r.reduce((x, v, i) => x + v * (r2[i] ?? 0), 0)));
  const b = components.map((r) => r.reduce((x, v, i) => x + v * (shares[i] ?? 0), 0));
  const at = (r: number, c: number) => (A[r] as number[])[c] as number;
  for (let c = 0; c < m; c += 1) {
    for (let r = c + 1; r < m; r += 1) {
      const f = at(r, c) / at(c, c);
      for (let k = c; k < m; k += 1) (A[r] as number[])[k] = at(r, k) - f * at(c, k);
      b[r] = (b[r] as number) - f * (b[c] as number);
    }
  }
  const w = new Array<number>(m).fill(0);
  for (let r = m - 1; r >= 0; r -= 1) {
    let v = b[r] as number;
    for (let k = r + 1; k < m; k += 1) v -= at(r, k) * (w[k] as number);
    w[r] = v / at(r, r);
  }
  const clamped = w.map((x) => Math.max(0, x));
  const total = clamped.reduce((a, b2) => a + b2, 0);
  const weights = clamped.map((x) => x / total);
  const ll = counts.reduce(
    (s, k, i) =>
      k === 0 ? s : s + k * Math.log(weights.reduce((a, wj, j) => a + wj * (components[j]?.[i] ?? 0), 0)),
    0,
  );
  return { weights, iterations: 1, logLikelihood: ll };
}

/** Coverage with the strength ignored (always 1): a plausible planted bug. */
export function strengthOneCoverage(rows: number[][], groups: CoverageGroup[], levels: number[]) {
  return goodCoverage(
    rows,
    groups.map((g) => ({ ...g, strength: Math.min(1, g.strength) })),
    levels,
  );
}
