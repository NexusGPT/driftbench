import { mulberry32, passAtK, passK, wilson } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { atKRows } from '../src/reliability';

const pK = (p: number, k: number) => p ** k;
const pA = (p: number, k: number) => 1 - (1 - p) ** k;

describe('pass^k and pass@k intervals', () => {
  it('every value lies inside its own interval, for every count, size and k', () => {
    for (let n = 1; n <= 10; n += 1) {
      for (let c = 0; c <= n; c += 1) {
        const w = wilson(c, n);
        for (const row of atKRows(c, n, w.lower, w.upper, pK, passK)) {
          expect(row.value).toBeGreaterThanOrEqual(row.lower);
          expect(row.value).toBeLessThanOrEqual(row.upper);
        }
        for (const row of atKRows(c, n, w.lower, w.upper, pA, passAtK)) {
          expect(row.value).toBeGreaterThanOrEqual(row.lower);
          expect(row.value).toBeLessThanOrEqual(row.upper);
        }
      }
    }
  });

  it('the interval covers the true pass^k and pass@k in at least 90% of seeded simulations', () => {
    const rng = mulberry32(20261012);
    const reps = 4000;
    for (const p of [0.3, 0.5, 0.7, 0.9]) {
      for (const n of [3, 5, 10]) {
        for (const k of [1, 2, 3].filter((x) => x <= n)) {
          let coverK = 0;
          let coverA = 0;
          for (let r = 0; r < reps; r += 1) {
            let c = 0;
            for (let i = 0; i < n; i += 1) if (rng() < p) c += 1;
            const w = wilson(c, n);
            const kRow = atKRows(c, n, w.lower, w.upper, pK, passK)[k - 1];
            const aRow = atKRows(c, n, w.lower, w.upper, pA, passAtK)[k - 1];
            if (kRow && p ** k >= kRow.lower && p ** k <= kRow.upper) coverK += 1;
            if (aRow && pA(p, k) >= aRow.lower && pA(p, k) <= aRow.upper) coverA += 1;
          }
          expect(coverK / reps, `pass^k p=${p} n=${n} k=${k}`).toBeGreaterThanOrEqual(0.9);
          expect(coverA / reps, `pass@k p=${p} n=${n} k=${k}`).toBeGreaterThanOrEqual(0.9);
        }
      }
    }
  });
});
