import { mulberry32 } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { clustered } from '../src/estimate';

/** Outcomes of one spec: a shared draw copied with chance sqrt(rho), else each repeat draws its own. */
function specOutcomes(rng: () => number, repeats: number, rate: number, rho: number): number[] {
  const copy = Math.sqrt(rho);
  const shared = rng() < rate ? 1 : 0;
  return Array.from({ length: repeats }, () => (rng() < copy ? shared : rng() < rate ? 1 : 0));
}

function coverage(specs: number, repeats: number, rho: number, draws: number, seed: number): number {
  const rng = mulberry32(seed);
  let held = 0;
  for (let d = 0; d < draws; d += 1) {
    const truth = 0.6 + 0.3 * rng();
    const values: number[] = [];
    const keys: number[] = [];
    for (let spec = 0; spec < specs; spec += 1) {
      for (const v of specOutcomes(rng, repeats, truth, rho)) {
        values.push(v);
        keys.push(spec);
      }
    }
    const ci = clustered(values, keys, { rate: true });
    if (ci && ci.lower <= truth && truth <= ci.upper) held += 1;
  }
  return held / draws;
}

describe('the interval of a pass rate over a few clusters', () => {
  it('holds the true rate in at least 93 percent of draws, 6 specs of 5 repeats at rho 0.3', () => {
    expect(coverage(6, 5, 0.3, 1000, 7)).toBeGreaterThanOrEqual(0.93);
  });

  it('holds the true rate in at least 93 percent of draws, 20 specs of 3 repeats at rho 0.3', () => {
    expect(coverage(20, 3, 0.3, 1000, 11)).toBeGreaterThanOrEqual(0.93);
  });

  it('names the design effect method and the clusters', () => {
    const ci = clustered([1, 1, 0, 1, 1, 0, 1, 1, 1], [0, 0, 0, 1, 1, 1, 2, 2, 2], { rate: true });
    expect(ci).toMatchObject({ method: 'wilson, design effect', clusters: 3, n: 9 });
    expect(ci?.lower).toBeGreaterThanOrEqual(0);
    expect(ci?.upper).toBeLessThanOrEqual(1);
  });
});
