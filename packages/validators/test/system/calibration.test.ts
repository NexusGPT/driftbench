import { readFileSync } from 'node:fs';
import * as stats from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { exactDesignEffectLaw, varianceItems } from '../../src/ladders/system/bank/variance';
import {
  CLUSTER_RHO,
  CLUSTER_SIZE,
  DEFF_ALPHA,
  designEffectCalibration,
  designEffectInterval,
  EFFECT_CAMPAIGNS,
  type EffectState,
  runEffect,
  type SystemStats,
  wilsonCalibration,
} from '../../src/ladders/system/effect';

const design = JSON.parse(
  readFileSync(new URL('../../fixtures/system/design.json', import.meta.url), 'utf8'),
);
const ROOT = new URL('../../../..', import.meta.url).pathname;
const PASS = { pass: true };

const effects = new Map<number, Promise<EffectState>>();
function effectOf(seed: number): Promise<EffectState> {
  let effect = effects.get(seed);
  if (!effect) {
    effect = runEffect(seed);
    effects.set(seed, effect);
  }
  return effect;
}

async function check(id: string, seed: number) {
  const item = varianceItems().find((each) => each.id === id);
  if (!item) throw new Error(`no item ${id}`);
  return item.check({ seed, root: ROOT, scratch: ROOT });
}

/** A design effect of 9 on every campaign: the design-effect measure must fail and the Wilson one must not move. */
const brokenDesignEffect: SystemStats = { ...stats, designEffect: () => 9 };
/** A Wilson interval that holds nothing: the Wilson measure must fail and the design-effect one must not move. */
const brokenWilson: SystemStats = {
  ...stats,
  wilson: (k, n) => ({ ...stats.wilson(k, n), lower: 2, upper: 2 }),
};

describe('the exact finite-sample law of the planted design effect (fixtures/system/design.json)', () => {
  it('has the mean of the truncated estimator, below the population value 1 + (m - 1) rho', () => {
    const law = exactDesignEffectLaw();
    expect(law.mean).toBeCloseTo(design.clustered.exactLaw.mean, 9);
    expect(law.sd).toBeCloseTo(design.clustered.exactLaw.sd, 9);
    expect(law.skew).toBeCloseTo(design.clustered.exactLaw.skew, 9);
    expect(law.mean).toBeLessThan(stats.designEffect(CLUSTER_SIZE, CLUSTER_RHO));
  });

  it('gives the acceptance interval of the mean over the campaigns at the recorded alpha', () => {
    const law = exactDesignEffectLaw();
    const [lower, upper] = designEffectInterval(law, EFFECT_CAMPAIGNS, DEFF_ALPHA);
    expect(DEFF_ALPHA).toBe(0.001);
    expect(lower).toBeCloseTo(design.clustered.interval.lower, 9);
    expect(upper).toBeCloseTo(design.clustered.interval.upper, 9);
    // The exact tails of the interval, from the lattice convolution recorded in the fixture, stay within alpha.
    expect(design.clustered.interval.below + design.clustered.interval.above).toBeLessThanOrEqual(DEFF_ALPHA);
  });
});

describe('seed 7167, the hidden seed of PRs 163 and 168', { timeout: 60_000 }, () => {
  it('passes the Wilson calibration item with its own coverage, 97 of 100', async () => {
    await expect(check('variance/wilson-calibration', 7167)).resolves.toEqual(PASS);
    expect(wilsonCalibration(await effectOf(7167), 7167, stats).value).toBe(0.97);
  });

  it('passes the design-effect calibration item against the exact finite-sample law', async () => {
    await expect(check('variance/design-effect-calibration', 7167)).resolves.toEqual(PASS);
  });
});

describe.each([7167, 1, 2])(
  'on seed %i neither calibration measure masks the other',
  { timeout: 60_000 },
  (seed) => {
    it('a broken design effect fails its own measure and leaves the Wilson coverage as it is', async () => {
      const effect = await effectOf(seed);
      const coverage = wilsonCalibration(effect, seed, stats).value;
      expect(coverage).toBeGreaterThanOrEqual(0.93);
      expect(designEffectCalibration(effect, seed, brokenDesignEffect, exactDesignEffectLaw()).value).toBe(0);
      expect(wilsonCalibration(effect, seed, brokenDesignEffect).value).toBe(coverage);
    });

    it('a broken Wilson interval fails its own measure and leaves the design-effect verdict as it is', async () => {
      const effect = await effectOf(seed);
      expect(wilsonCalibration(effect, seed, brokenWilson).value).toBe(0);
      expect(designEffectCalibration(effect, seed, brokenWilson, exactDesignEffectLaw()).value).toBe(1);
    });
  },
);
