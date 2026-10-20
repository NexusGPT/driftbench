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
    expect(CLUSTERED_CAMPAIGNS).toBe(225);
    expect(lower).toBeCloseTo(design.clustered.interval.lower, 9);
    expect(upper).toBeCloseTo(design.clustered.interval.upper, 9);
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
const plantedStates = new Map<number, EffectState>();
function plantedState(seed: number): EffectState {
  let state = plantedStates.get(seed);
  if (!state) {
    state = readPlant(seed);
    plantedStates.set(seed, state);
  }
  return state;
}
function readPlant(seed: number): EffectState {
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
  ['a design effect 5 percent too high', { ...stats, designEffect: (m, rho) => 1.05 * (1 + (m - 1) * rho) }],
  ['a design effect 5 percent too low', { ...stats, designEffect: (m, rho) => 0.95 * (1 + (m - 1) * rho) }],
  ['a cluster size weighted as m - 2', { ...stats, designEffect: (m, rho) => 1 + (m - 2) * rho }],
  ['an ignored intra-class correlation', { ...stats, icc: (r) => stats.icc(r).map((e) => ({ ...e, icc: 0 })) }],
];

describe('the design-effect item against wrong estimators', { timeout: 120_000 }, () => {
  it('reads the same clustered runs from the plant as the runner and the store give back (seeds 7167, 1, 2)', async () => {
    for (const seed of [7167, 1, 2])
      expect(plantedState(seed).clusters).toEqual((await effectOf(seed)).clusters);
  });

  it.each(WRONG)('fails %s on seed 7167 through the runner and the store', async (_name, wrong) => {
    expect(designEffectCalibration(await effectOf(7167), 7167, wrong, designEffectOracle()).value).toBe(0);
  });

  it.each(WRONG)('fails %s on every seed from 1 to 20 and on seed 2323', (_name, wrong) => {
    const passing: number[] = [];
    for (const seed of [...Array.from({ length: 20 }, (_, i) => i + 1), 2323]) {
      if (designEffectCalibration(plantedState(seed), seed, wrong, designEffectOracle()).value !== 0)
        passing.push(seed);
    }
    expect(passing).toEqual([]);
  });

  it('passes the correct statistics on every seed from 1 to 20 and on seed 2323, the seed the old interval missed', () => {
    const failing: number[] = [];
    for (const seed of [...Array.from({ length: 20 }, (_, i) => i + 1), 2323]) {
      if (designEffectCalibration(plantedState(seed), seed, stats, designEffectOracle()).value !== 1)
        failing.push(seed);
    }
    expect(failing).toEqual([]);
  });

  it('keeps the power of the old interval: no wider a half-width than 100 campaigns at 0.001', () => {
    const law = exactDesignEffectLaw();
    const half = (n: number, alpha: number) => {
      const [lower, upper] = designEffectInterval(law, n, alpha);
      return (upper - lower) / 2;
    };
    expect(half(CLUSTERED_CAMPAIGNS, DEFF_LAW_ALPHA)).toBeLessThanOrEqual(half(100, 0.001));
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

describe('the design-effect item against a wrong bootstrap interval', { timeout: 120_000 }, () => {
  it.each(WRONG_BOOTSTRAP)(
    'fails %s on seed 7167 and on every seed from 10000 to 10099',
    async (_name, wrong) => {
      expect(designEffectCalibration(await effectOf(7167), 7167, wrong, designEffectOracle()).value).toBe(0);
      const passing: number[] = [];
      for (let seed = 10000; seed <= 10099; seed += 1) {
        if (designEffectCalibration(plantedState(seed), seed, wrong, designEffectOracle()).value !== 0)
          passing.push(seed);
      }
      expect(passing).toEqual([]);
    },
  );
});

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
function latticeSum(round: (x: number) => number, step: number, copies: number): Float64Array {
  const outcomes = designEffectOutcomes();
  // A value on the lattice must stay on it: (x - 1) / step is off an integer by rounding error only.
  const cell = (x: number) => round(Number(((x - 1) / step).toFixed(6)));
  const top = Math.max(...outcomes.map(([, x]) => cell(x)));
  const length = top * copies + 1;
  let n = 1;
  while (n < length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (const [p, x] of outcomes) re[cell(x)] = (re[cell(x)] as number) + p;
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
    timeout: 120_000,
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
    expect(massBelow).toBeLessThan(DEFF_LAW_ALPHA / 2);
    expect(massAbove).toBeLessThan(DEFF_LAW_ALPHA / 2);
    expect(below + above).toBeLessThanOrEqual(DEFF_LAW_ALPHA);
  });
});
