import * as stats from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { POWER_GAP, powerLevel } from '../../src/ladders/stats/index';
import { committedDesigns, real, SLOW } from './support';

describe('level 6: minimum detectable effect power', { timeout: SLOW }, () => {
  const plan = committedDesigns().power;

  it('passes on the committed designs: the simulated power is within 5 points of the planned power', () => {
    const measure = powerLevel(1, real, plan);
    expect(measure.items).toEqual([]);
    expect(measure.value).toBeLessThanOrEqual(POWER_GAP);
  });

  it('fails when the plan ignores the correlation of repeats, naming each clustered design', () => {
    const optimistic: typeof stats.mde = (input) => stats.mde({ ...input, rho: 0 });
    const measure = powerLevel(1, { ...real, mde: optimistic }, plan);
    expect(measure.value).toBeGreaterThan(POWER_GAP);
    const clustered = plan.designs
      .filter((design) => design.rho >= 0.2)
      .map((design) => `power-${design.id}`);
    expect(measure.items.map((item) => item.id)).toEqual(expect.arrayContaining(clustered));
    expect(measure.items.map((item) => item.id)).not.toContain('power-n60-r1-p0.85');
    expect(measure.items[0]?.component).toBe('packages/stats/src/power.ts');
    expect(measure.items[0]?.detail).toMatch(
      /^estimator mde, seed 1, design n80-r3-p0\.8 \(80 specs of 3 repeats per version, baseline 0\.8, rho 0\.3\): minimum detectable effect [\d.]+ \(effective n [\d.]+\), predicted power 0\.8, simulated power [\d.]+ \(\d+ of 2000 campaigns detected the drop\), gap [\d.]+$/,
    );
  });

  it('fails when the effect is half of what the formula gives', () => {
    const halved: typeof stats.mde = (input) => {
      const result = stats.mde(input);
      return { ...result, effect: result.effect === null ? null : result.effect / 2 };
    };
    const measure = powerLevel(2, { ...real, mde: halved }, plan);
    expect(measure.items.map((item) => item.id)).toEqual(plan.designs.map((design) => `power-${design.id}`));
  });

  it('names a design for which no effect comes back', () => {
    const none: typeof stats.mde = (input) => ({ ...stats.mde(input), effect: null });
    const measure = powerLevel(1, { ...real, mde: none }, plan);
    expect(measure.value).toBe(1);
    expect(measure.items[0]?.detail).toBe(
      'estimator mde, seed 1, design n60-r1-p0.85 (60 specs of 1 repeats per version, baseline 0.85, rho 0): no detectable effect was returned (null) for power 0.8',
    );
  });
});
