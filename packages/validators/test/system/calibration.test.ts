import { readFileSync } from 'node:fs';
import * as stats from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import {
  designEffectOracle,
  exactDesignEffectLaw,
  varianceItems,
} from '../../src/ladders/system/bank/variance';
import {
  CLUSTER_RHO,
  CLUSTER_SIZE,
  DEFF_ALPHA,
  designEffectCalibration,
  designEffectInterval,
  EFFECT_CAMPAIGNS,
  type EffectState,
  PLANTED_TARGET,
  plantEffect,
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
      expect(designEffectCalibration(effect, seed, brokenDesignEffect, designEffectOracle()).value).toBe(0);
      expect(wilsonCalibration(effect, seed, brokenDesignEffect).value).toBe(coverage);
    });

    it('a broken Wilson interval fails its own measure and leaves the design-effect verdict as it is', async () => {
      const effect = await effectOf(seed);
      expect(wilsonCalibration(effect, seed, brokenWilson).value).toBe(0);
      expect(designEffectCalibration(effect, seed, brokenWilson, designEffectOracle()).value).toBe(1);
    });
  },
);

/**
 * The clustered campaigns of a seed read from the plant itself, without the runner and the store: each spec's
 * behaviour answered CLUSTER_SIZE times in order, a run passing when the reply matches the spec's pattern.
 */
function plantedState(seed: number): EffectState {
  const plant = plantEffect(seed);
  const clusters = plant.clustered.map((campaign) =>
    campaign.specs.map((spec) => {
      const block = (spec.blocks as unknown[])[0] as { when: { user: string }; expect: { must: string[] } };
      const behaviour = plant.behaviours.get(block.when.user);
      if (!behaviour) throw new Error(`no behaviour for ${spec.id}`);
      const pattern = new RegExp(block.expect.must[0] as string);
      return Array.from({ length: CLUSTER_SIZE }, () =>
        pattern.test((behaviour({ ...PLANTED_TARGET, variant: 'clustered' }) as { text: string }).text),
      );
    }),
  );
  return { plant, flags: [], clusters, problems: [] };
}

/** The wrong estimators of the review of PR 176 (scratchpad review-176): each must fail the item on every seed. */
const WRONG: Array<[string, SystemStats]> = [
  [
    'a constant correlation of 0.7 / 3 (design effect 1.70)',
    { ...stats, icc: (r) => stats.icc(r).map((e) => ({ ...e, icc: 0.7 / 3 })) },
  ],
  [
    'the correlation scaled by 0.85',
    { ...stats, icc: (r) => stats.icc(r).map((e) => ({ ...e, icc: e.icc * 0.85 })) },
  ],
  ['a design effect of 1 + m rho', { ...stats, designEffect: (m, rho) => 1 + m * rho }],
];

describe('the design-effect item against wrong estimators', { timeout: 120_000 }, () => {
  it('reads the same clustered runs from the plant as the runner and the store give back (seeds 7167, 1, 2)', async () => {
    for (const seed of [7167, 1, 2])
      expect(plantedState(seed).clusters).toEqual((await effectOf(seed)).clusters);
  });

  it.each(WRONG)('fails %s on seed 7167 through the runner and the store', async (_name, wrong) => {
    expect(designEffectCalibration(await effectOf(7167), 7167, wrong, designEffectOracle()).value).toBe(0);
  });

  it.each(WRONG)('fails %s on every seed from 10000 to 10099', (_name, wrong) => {
    const passing: number[] = [];
    for (let seed = 10000; seed <= 10099; seed += 1) {
      if (designEffectCalibration(plantedState(seed), seed, wrong, designEffectOracle()).value !== 0)
        passing.push(seed);
    }
    expect(passing).toEqual([]);
  });

  it('passes the correct statistics on seed 7167 and on the seeds from 10000 to 10099', async () => {
    expect(designEffectCalibration(await effectOf(7167), 7167, stats, designEffectOracle()).value).toBe(1);
    const failing: number[] = [];
    for (let seed = 10000; seed <= 10099; seed += 1) {
      if (designEffectCalibration(plantedState(seed), seed, stats, designEffectOracle()).value !== 1)
        failing.push(seed);
    }
    expect(failing).toEqual([]);
  });
});
