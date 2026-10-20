import { describe, expect, it } from 'vitest';
import { statsBank } from '../../src/ladders/stats/bank';
import { runItem } from '../../src/ladders/stats/bank/index';
import type { StatsImpl } from '../../src/ladders/stats/reference';

const ROOT = process.cwd();
const mixtureItems = statsBank(ROOT).filter((item) => item.family === 'weights-mixture');
const SEEDS = [1, 2, 977, 4242];

type Mix = (
  components: number[][],
  counts: number[],
) => { weights: number[]; iterations: number; logLikelihood: number };

function loglik(components: number[][], counts: number[], w: number[]): number {
  return counts.reduce((sum, k, i) => {
    if (k === 0) return sum;
    return sum + k * Math.log(w.reduce((a, wj, j) => a + wj * (components[j]?.[i] ?? 0), 0));
  }, 0);
}

function checkArgs(components: number[][], counts: number[]): void {
  if (components.length === 0) throw new RangeError('mixtureWeights: components is empty');
  if (components.some((row) => row.length !== counts.length))
    throw new RangeError('mixtureWeights: a component has another length than counts');
  if (
    components.some(
      (row) => row.some((v) => !(v >= 0 && v <= 1)) || Math.abs(row.reduce((a, b) => a + b, 0) - 1) > 1e-12,
    )
  )
    throw new RangeError('mixtureWeights: components must be probability rows');
  if (counts.some((k) => !Number.isInteger(k) || k < 0))
    throw new RangeError('mixtureWeights: counts must be non-negative integers');
  if (counts.every((k) => k === 0)) throw new RangeError('mixtureWeights: counts are all 0');
}

/** Expectation-maximisation to a fixed point: the maximum-likelihood mix. */
const em: Mix = (components, counts) => {
  checkArgs(components, counts);
  const m = components.length;
  const N = counts.reduce((a, b) => a + b, 0);
  let w = new Array<number>(m).fill(1 / m);
  for (let step = 0; step < 2_000_000; step += 1) {
    const next = new Array<number>(m).fill(0);
    counts.forEach((k, i) => {
      if (k === 0) return;
      const mixture = w.reduce((a, wj, j) => a + wj * (components[j]?.[i] ?? 0), 0);
      w.forEach((wj, j) => {
        next[j] = (next[j] ?? 0) + (k * wj * (components[j]?.[i] ?? 0)) / mixture;
      });
    });
    const updated = next.map((v) => v / N);
    const moved = updated.reduce((x, v, j) => Math.max(x, Math.abs(v - (w[j] ?? 0))), 0);
    w = updated;
    if (moved < 1e-15) break;
  }
  return { weights: w, iterations: 1, logLikelihood: loglik(components, counts, w) };
};

/** Least squares on the shares (normal equations, clamped at 0, renormalised): consistent, but not maximum likelihood. */
const leastSquares: Mix = (components, counts) => {
  checkArgs(components, counts);
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
  return { weights, iterations: 1, logLikelihood: loglik(components, counts, weights) };
};

async function failing(mix: Mix, seed: number, prefix: string): Promise<{ failed: number; of: number }> {
  const items = mixtureItems.filter((item) => item.id.startsWith(prefix));
  let failed = 0;
  for (const item of items) {
    const outcome = await runItem(item, seed, ROOT, { mixtureWeights: mix } as unknown as StatsImpl);
    if (!outcome.pass) failed += 1;
  }
  return { failed, of: items.length };
}

describe('the weights-mixture items tell the maximum-likelihood mix from a consistent estimator', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: expectation-maximisation passes every recover, em and refuse item`, async () => {
      for (const prefix of ['weights.recover.', 'weights.em.', 'weights.refuse.']) {
        expect(await failing(em, seed, prefix)).toMatchObject({ failed: 0 });
      }
    });

    it(`seed ${seed}: least squares passes the exact-mix items and fails nearly every em item`, async () => {
      expect(await failing(leastSquares, seed, 'weights.recover.')).toMatchObject({ failed: 0 });
      const emItems = await failing(leastSquares, seed, 'weights.em.');
      expect(emItems.failed).toBeGreaterThanOrEqual(Math.floor(emItems.of * 0.8));
    });
  }
});
