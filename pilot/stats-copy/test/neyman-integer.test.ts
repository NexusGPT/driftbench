import { describe, expect, it } from 'vitest';
import { mulberry32, neymanAllocation } from '../src/index';

// allocated: the whole numbers adding up to total with the lowest stratified variance sum N^2 S^2 / n.
const objective = (sizes: number[], sds: number[], n: readonly number[]): number =>
  sizes.reduce((s, size, h) => {
    const w = size * (sds[h] as number);
    if (w === 0) return s;
    return s + (w * w) / (n[h] as number);
  }, 0);

// All compositions of total into parts, each part a count >= 0.
function compositions(parts: number, total: number): number[][] {
  if (parts === 1) return [[total]];
  const out: number[][] = [];
  for (let first = 0; first <= total; first += 1) {
    for (const rest of compositions(parts - 1, total - first)) out.push([first, ...rest]);
  }
  return out;
}

function bruteBest(sizes: number[], sds: number[], total: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const n of compositions(sizes.length, total)) {
    const v = objective(sizes, sds, n);
    if (v < best) best = v;
  }
  return best;
}

describe('neymanAllocation integer allocation', () => {
  it('finds the optimum that largest-remainder rounding misses', () => {
    const sizes = [46, 12, 95];
    const sds = [0.23, 0.12, 0.21];
    const r = neymanAllocation({ sizes, sds, total: 8 });
    expect(r.allocated.reduce((s, v) => s + v, 0)).toBe(8);
    expect(objective(sizes, sds, r.allocated)).toBeCloseTo(137.6423, 3);
    expect(r.allocated).toEqual([2, 1, 5]);
  });

  it('samples every stratum that has spread when the total allows', () => {
    const r = neymanAllocation({ sizes: [1000, 1, 1], sds: [1, 0.1, 0.1], total: 6 });
    expect(Math.min(...r.allocated)).toBeGreaterThanOrEqual(1);
    const r2 = neymanAllocation({ sizes: [10, 10], sds: [5, 0.001], total: 3 });
    expect(r2.allocated).toEqual([2, 1]);
  });

  it('matches an exhaustive search on random small cases', () => {
    const rand = mulberry32(7);
    for (let t = 0; t < 40; t += 1) {
      const strata = 2 + Math.floor(rand() * 3);
      const sizes = Array.from({ length: strata }, () => 5 + Math.floor(rand() * 300));
      const sds = Array.from({ length: strata }, () => 0.05 + rand() * 3);
      const total = strata + Math.floor(rand() * 10);
      const r = neymanAllocation({ sizes, sds, total });
      expect(r.allocated.reduce((s, v) => s + v, 0)).toBe(total);
      expect(objective(sizes, sds, r.allocated)).toBeCloseTo(bruteBest(sizes, sds, total), 9);
    }
  });

  it('keeps the exact shares and a zero-spread stratum at no sample', () => {
    const r = neymanAllocation({ sizes: [100, 100, 100], sds: [1, 0, 1], total: 10 });
    expect(r.allocated).toEqual([5, 0, 5]);
    expect(r.exact[0]).toBeCloseTo(5, 12);
  });
});
