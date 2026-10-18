import { showNumber } from '../../format';
import type { Item, Measure } from '../../ladder';
import type { PowerDesigns } from './designs';
import { clusterOutcomes, generator, salt } from './draw';
import type { StatsImpl } from './reference';

/**
 * Level 6 of the statistics validator: the minimum detectable effect means what it says. For each planned
 * campaign (specs per version, repeats per spec, the baseline pass rate, the intraclass correlation of the
 * repeats, the power asked for), `mde` gives the smallest drop it detects. The validator then runs the campaign
 * `draws` times with that drop planted: the baseline version passes at the baseline rate, the candidate at the
 * rate minus the effect, repeats of one spec correlated as planned. Each run gets the test the plan assumes,
 * a two-sided test of two proportions at level alpha whose variance counts each run as 1 / design effect of an
 * independent one, with the design effect 1 + (repeats - 1) rho computed here. The simulated power is the share
 * of runs that detect the drop; it must lie within 5 points of the power asked for.
 */

export const POWER_GAP = 0.05;

/** The component a gap points at. */
export const POWER_COMPONENT = 'packages/stats/src/power.ts';

/**
 * For each design, the gap between the power asked for and the simulated power at the minimum detectable
 * effect. The observed value is the largest gap; a design over 5 points is an item.
 */
export function powerLevel(seed: number, s: StatsImpl, plan: PowerDesigns): Measure {
  const items: Item[] = [];
  let worst = 0;
  const z = s.normalQuantile(1 - plan.alpha / 2);
  plan.designs.forEach((design, index) => {
    const planned = s.mde({
      n: design.n,
      repeats: design.repeats,
      baselineRate: design.baselineRate,
      power: design.power,
      alpha: plan.alpha,
      rho: design.rho,
    });
    const what = `${design.n} specs of ${design.repeats} repeats per version, baseline ${design.baselineRate}, rho ${design.rho}`;
    if (planned.effect === null || !(planned.effect > 0 && planned.effect < design.baselineRate)) {
      worst = Math.max(worst, 1);
      items.push({
        id: `power-${design.id}`,
        component: POWER_COMPONENT,
        detail: `estimator mde, seed ${seed}, design ${design.id} (${what}): no detectable effect was returned (${String(planned.effect)}) for power ${design.power}`,
      });
      return;
    }
    const candidateRate = design.baselineRate - planned.effect;
    const units = design.n * design.repeats;
    const deff = 1 + (design.repeats - 1) * design.rho;
    const rng = generator(seed, salt(6, index));
    const rate = (truth: number): number => {
      let passed = 0;
      for (let spec = 0; spec < design.n; spec += 1) {
        for (const value of clusterOutcomes(rng, design.repeats, truth, design.rho)) passed += value;
      }
      return passed / units;
    };
    let detected = 0;
    for (let draw = 0; draw < plan.draws; draw += 1) {
      const baseline = rate(design.baselineRate);
      const candidate = rate(candidateRate);
      const pooled = (baseline + candidate) / 2;
      const se = Math.sqrt((2 * pooled * (1 - pooled) * deff) / units);
      if (se > 0 && Math.abs(baseline - candidate) / se > z) detected += 1;
    }
    const simulated = detected / plan.draws;
    const gap = Math.abs(simulated - design.power);
    worst = Math.max(worst, gap);
    if (!(gap <= POWER_GAP)) {
      items.push({
        id: `power-${design.id}`,
        component: POWER_COMPONENT,
        detail: `estimator mde, seed ${seed}, design ${design.id} (${what}): minimum detectable effect ${showNumber(planned.effect)} (effective n ${showNumber(planned.effectiveN)}), predicted power ${showNumber(design.power)}, simulated power ${showNumber(simulated)} (${detected} of ${plan.draws} campaigns detected the drop), gap ${showNumber(gap)}`,
      });
    }
  });
  return { value: worst, items };
}
