import { readFileSync } from 'node:fs';
import * as stats from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import {
  designEffectOracle,
  designEffectOutcomes,
  exactDesignEffectLaw,
  varianceItems,
} from '../../src/ladders/system/bank/variance';
import {
  CLUSTER_RHO,
  CLUSTER_SIZE,
  CLUSTERED_CAMPAIGNS,
  DEFF_LAW_ALPHA,
  designEffectCalibration,
  designEffectInterval,
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
    const [lower, upper] = designEffectInterval(law, CLUSTERED_CAMPAIGNS, DEFF_LAW_ALPHA);
    expect(DEFF_LAW_ALPHA).toBe(1e-6);
    expect(CLUSTERED_CAMPAIGNS).toBe(1740);
    expect(lower).toBeCloseTo(design.clustered.interval.lower, 9);
    expect(upper).toBeCloseTo(design.clustered.interval.upper, 9);
  });
});

describe('seed 7167, the hidden seed of PRs 163 and 168', { timeout: 600_000 }, () => {
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
  { timeout: 600_000 },
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
let planted: { key: string; state: EffectState } | undefined;
/** The state of the last seed asked for only: a state holds CLUSTERED_CAMPAIGNS campaigns, too many to keep. */
function plantedState(seed: number, rho = CLUSTER_RHO, campaigns = CLUSTERED_CAMPAIGNS): EffectState {
  const key = `${seed} ${rho} ${campaigns}`;
  if (planted?.key !== key) planted = { key, state: readPlant(seed, rho, campaigns) };
  return planted.state;
}
function readPlant(seed: number, rho: number, campaigns: number): EffectState {
  const plant = plantEffect(seed, 1, campaigns, rho);
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
  ['a design effect 5 percent too high', { ...stats, designEffect: (m, rho) => 1.05 * (1 + (m - 1) * rho) }],
  ['a design effect 5 percent too low', { ...stats, designEffect: (m, rho) => 0.95 * (1 + (m - 1) * rho) }],
  ['a cluster size weighted as m - 2', { ...stats, designEffect: (m, rho) => 1 + (m - 2) * rho }],
  [
    'an ignored intra-class correlation',
    { ...stats, icc: (r) => stats.icc(r).map((e) => ({ ...e, icc: 0 })) },
  ],
];

const SEEDS = [...Array.from({ length: 20 }, (_, i) => i + 1), 2323];
const FAR_SEEDS = Array.from({ length: 50 }, (_, i) => 10000 + i);

describe('the design-effect item against wrong estimators', { timeout: 900_000 }, () => {
  it('reads the same clustered runs from the plant as the runner and the store give back (seeds 7167, 1)', async () => {
    for (const seed of [7167, 1])
      expect(plantedState(seed).clusters).toEqual((await effectOf(seed)).clusters);
  });

  it.each(WRONG)('fails %s on seed 7167 through the runner and the store', async (_name, wrong) => {
    expect(designEffectCalibration(await effectOf(7167), 7167, wrong, designEffectOracle()).value).toBe(0);
  });

  it('passes the correct statistics on seed 7167 through the runner and the store', async () => {
    expect(designEffectCalibration(await effectOf(7167), 7167, stats, designEffectOracle()).value).toBe(1);
  });

  it('fails every wrong estimator and every wrong bootstrap interval, and passes the correct statistics, on seeds 1 to 20, 2323 and 10000 to 10049', () => {
    const wrongPass: string[] = [];
    const correctFail: number[] = [];
    for (const seed of [...SEEDS, ...FAR_SEEDS]) {
      const state = plantedState(seed);
      for (const [name, wrong] of [...WRONG, ...WRONG_BOOTSTRAP])
        if (designEffectCalibration(state, seed, wrong, designEffectOracle()).value !== 0)
          wrongPass.push(`${name} on seed ${seed}`);
      if (designEffectCalibration(state, seed, stats, designEffectOracle()).value !== 1)
        correctFail.push(seed);
    }
    expect(wrongPass).toEqual([]);
    expect(correctFail).toEqual([]);
  });

  it('keeps no wider an acceptance interval than the old one: half-width at 1740 campaigns and 1e-6 against 100 and 0.001', () => {
    const law = exactDesignEffectLaw();
    const half = (n: number, alpha: number) => {
      const [lower, upper] = designEffectInterval(law, n, alpha);
      return (upper - lower) / 2;
    };
    expect(half(CLUSTERED_CAMPAIGNS, DEFF_LAW_ALPHA)).toBeLessThanOrEqual(half(100, 0.001));
  });
});

/** Wrong bootstrap intervals (review of PR 183, R1): the old item used the bootstrap, so each must still fail. */
const reshape =
  (
    f: (b: ReturnType<typeof stats.bootstrapCI>) => { lower: number; upper: number },
  ): SystemStats['bootstrapCI'] =>
  (values, options) => {
    const b = stats.bootstrapCI(values, options);
    return { ...b, ...f(b) };
  };
const WRONG_BOOTSTRAP: Array<[string, SystemStats]> = [
  [
    'a degenerate interval [estimate, estimate]',
    { ...stats, bootstrapCI: reshape((b) => ({ lower: b.estimate, upper: b.estimate })) },
  ],
  [
    'an interval that ignores alpha (always 0.05)',
    { ...stats, bootstrapCI: (values, options) => stats.bootstrapCI(values, { ...options, alpha: 0.05 }) },
  ],
  [
    'an interval of half the width',
    {
      ...stats,
      bootstrapCI: reshape((b) => ({
        lower: b.estimate - (b.estimate - b.lower) / 2,
        upper: b.estimate + (b.upper - b.estimate) / 2,
      })),
    },
  ],
  [
    'an interval shifted up by one standard error (0.037)',
    { ...stats, bootstrapCI: reshape((b) => ({ lower: b.lower + 0.037, upper: b.upper + 0.037 })) },
  ],
];

/** In-place radix-2 transform of a complex signal (re, im); inverse without the 1 / n scale when sign is 1. */
function fft(re: Float64Array, im: Float64Array, sign: -1 | 1): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = (sign * 2 * Math.PI) / len;
    for (let k = 0; k < half; k += 1) {
      const wr = Math.cos(step * k);
      const wi = Math.sin(step * k);
      for (let i = k; i < n; i += len) {
        const j = i + half;
        const xr = (re[j] as number) * wr - (im[j] as number) * wi;
        const xi = (re[j] as number) * wi + (im[j] as number) * wr;
        re[j] = (re[i] as number) - xr;
        im[j] = (im[i] as number) - xi;
        re[i] = (re[i] as number) + xr;
        im[i] = (im[i] as number) + xi;
      }
    }
  }
}

/**
 * The law of the sum of `copies` independent design effects, each first moved onto the lattice 1 + i step by
 * `round` (down or up), as the mass of each lattice sum: the pmf to the power `copies` in the frequency domain.
 */
function latticeSum(
  round: (x: number) => number,
  step: number,
  copies: number,
  outcomes = designEffectOutcomes(),
): Float64Array {
  // A value on the lattice must stay on it: (x - 1) / step is off an integer by rounding error only.
  const cell = (x: number) => round(Number(((x - 1) / step).toFixed(6)));
  const top = Math.max(...outcomes.map(([, x]) => cell(x)));
  const length = top * copies + 1;
  let n = 1;
  while (n < length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const total = outcomes.reduce((sum, [p]) => sum + p, 0);
  for (const [p, x] of outcomes) re[cell(x)] = (re[cell(x)] as number) + p / total;
  fft(re, im, -1);
  for (let i = 0; i < n; i += 1) {
    const radius = Math.hypot(re[i] as number, im[i] as number) ** copies;
    const angle = Math.atan2(im[i] as number, re[i] as number) * copies;
    re[i] = radius * Math.cos(angle);
    im[i] = radius * Math.sin(angle);
  }
  fft(re, im, 1);
  return re.subarray(0, length).map((mass) => Math.max(0, mass / n));
}

describe('the error of the design-effect interval (fixtures/system/design.json, clustered.interval)', () => {
  it('recomputes the two tail masses as upper bounds from the exact law, and their sum stays within alpha', {
    timeout: 900_000,
  }, () => {
    const step = 1e-4;
    const { lower, upper, below, above } = design.clustered.interval;
    // Rounding every value down can only move the mean down: the mass under the lower bound is then an upper
    // bound of the true one. Rounding up does the same for the mass over the upper bound.
    const down = latticeSum(Math.floor, step, CLUSTERED_CAMPAIGNS);
    const up = latticeSum(Math.ceil, step, CLUSTERED_CAMPAIGNS);
    const meanAt = (i: number) => 1 + (i * step) / CLUSTERED_CAMPAIGNS;
    let massBelow = 0;
    for (let i = 0; meanAt(i) < lower; i += 1) massBelow += down[i] as number;
    let massAbove = 0;
    for (let i = up.length - 1; meanAt(i) > upper; i -= 1) massAbove += up[i] as number;
    expect(massBelow).toBeCloseTo(below, 9);
    expect(massAbove).toBeCloseTo(above, 9);
    // Rounding every value by up to one step moves the mean by up to one step, which inflates a tail bound by
    // exp(z step / se): 1.055 here (z 4.89, se 0.0089, step 1e-4). The tails hold alpha / 2 within that allowance.
    const allowance = 1.06;
    expect(massBelow).toBeLessThan((allowance * DEFF_LAW_ALPHA) / 2);
    expect(massAbove).toBeLessThan((allowance * DEFF_LAW_ALPHA) / 2);
    expect(below + above).toBeLessThanOrEqual(allowance * DEFF_LAW_ALPHA);
  });
});

/**
 * The exact chance that the law check rejects a chain planted at correlation `rho`: the mass of the mean of `n`
 * campaigns outside the acceptance interval of the planted law at `alpha`, from the lattice sum of the enumerated
 * law of one campaign at `rho` (nearest rounding, step 1e-3).
 */
function rejection(rho: number, n: number, alpha: number): number {
  const step = 1e-3;
  const [lower, upper] = designEffectInterval(exactDesignEffectLaw(), n, alpha);
  const law = latticeSum(Math.round, step, n, designEffectOutcomes(20, CLUSTER_SIZE, 0.8, rho));
  let mass = 0;
  for (let i = 0; i < law.length; i += 1) {
    const mean = 1 + (i * step) / n;
    if (mean < lower || mean > upper) mass += law[i] as number;
  }
  return mass;
}

describe('the power of the law check against a chain planted at another correlation (fixtures/system/design.json, clustered.power)', {
  timeout: 900_000,
}, () => {
  const power = design.clustered.power;

  it.each([0.23, 0.27])(
    'rejects a chain at rho %f at least as often as the old item (100 campaigns, 0.001)',
    (rho) => {
      const old = rejection(rho, 100, 0.001);
      const now = rejection(rho, CLUSTERED_CAMPAIGNS, DEFF_LAW_ALPHA);
      expect(old).toBeCloseTo(power[String(rho)].old, 5);
      expect(now).toBeCloseTo(power[String(rho)].now, 5);
      expect(now).toBeGreaterThanOrEqual(old);
    },
  );

  it('has the smallest count of the recorded scan: 1735 campaigns reject rho 0.27 less often than the old item', () => {
    expect(rejection(0.27, 1735, DEFF_LAW_ALPHA)).toBeLessThan(rejection(0.27, 100, 0.001));
  });

  it.each([0.23, 0.27])(
    'fails the recorded seeds of a chain planted at rho %f (red first)',
    (rho) => {
      const seeds: number[] = power[String(rho)].failingSeeds;
      expect(seeds.length).toBeGreaterThan(0);
      const passing: number[] = [];
      for (const seed of seeds) {
        const state = plantedState(seed, rho);
        const measure = designEffectCalibration(state, seed, stats, designEffectOracle());
        if (measure.value !== 0 || !measure.items.some((item) => item.id === 'design-effect'))
          passing.push(seed);
      }
      expect(passing).toEqual([]);
    },
    900_000,
  );
});
