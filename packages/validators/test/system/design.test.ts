import { readFileSync } from 'node:fs';
import { binomialCdf, designEffect, logGamma, wilson } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import * as plant from '../../src/ladders/system/effect';

const design = JSON.parse(
  readFileSync(new URL('../../fixtures/system/design.json', import.meta.url), 'utf8'),
);

/** The exact coverage of the default Wilson interval at n and p: the binomial mass of the counts it covers. */
function exactCoverage(n: number, p: number): number {
  let covered = 0;
  for (let k = 0; k <= n; k += 1) {
    const ci = wilson(k, n);
    if (ci.lower <= p && p <= ci.upper) {
      covered += Math.exp(
        logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p),
      );
    }
  }
  return covered;
}

describe('the planted effect design point (fixtures/system/design.json)', () => {
  it('holds the constants of the plant', () => {
    expect(design.effect).toEqual({
      campaigns: plant.EFFECT_CAMPAIGNS,
      pairs: plant.EFFECT_PAIRS,
      baselineRate: plant.BASELINE_RATE,
      drop: plant.PLANTED_DROP,
      margin: plant.PARITY_MARGIN,
    });
    expect(design.clustered).toMatchObject({
      clusters: plant.CLUSTERS,
      size: plant.CLUSTER_SIZE,
      rate: plant.CLUSTER_RATE,
      rho: plant.CLUSTER_RHO,
      campaigns: plant.CLUSTERED_CAMPAIGNS,
      alpha: plant.DEFF_LAW_ALPHA,
    });
  });

  it('records the exact Wilson coverage at the design point and the chance a correct chain misses the bar', () => {
    const coverage = exactCoverage(plant.EFFECT_PAIRS, plant.BASELINE_RATE);
    expect(coverage).toBeCloseTo(design.wilson.exactCoverage, 9);
    expect(coverage).toBeGreaterThan(0.97);
    const below = Math.ceil(plant.CALIBRATION_BAR * plant.EFFECT_CAMPAIGNS) - 1;
    expect(binomialCdf(below, plant.EFFECT_CAMPAIGNS, coverage)).toBeCloseTo(
      design.wilson.falseFailPerSeed,
      8,
    );
  });

  it('plants two cluster rates whose run correlation is exactly rho, and the true design effect', () => {
    const [low, high] = design.clustered.rates as [number, number];
    const rate = plant.CLUSTER_RATE;
    const variance = ((low - rate) ** 2 + (high - rate) ** 2) / 2;
    expect(variance / (rate * (1 - rate))).toBeCloseTo(plant.CLUSTER_RHO, 10);
    expect(designEffect(plant.CLUSTER_SIZE, plant.CLUSTER_RHO)).toBe(design.clustered.trueDesignEffect);
  });
});
