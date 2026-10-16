import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bankItems, SeedData } from '../../src/ladders/generator/bank';
import {
  SCALE_GROWTH_BOUND,
  type ScaleGrowth,
  type ScaleReport,
  scaledSpec,
  scaleGrowth,
  scaleReport,
} from '../../src/ladders/generator/scale';
import { costOf } from './fixtures/metered-cost';

// The scale timing runs on a fake CPU meter that only a planted product advances (fixtures/metered-product.ts),
// so no real duration, load or host speed is an oracle: every number below is exact.
const METERED = fileURLToPath(new URL('./fixtures/metered-product.ts', import.meta.url));
const FACTORS: readonly [number, number] = [2, 20];
const SEED = 1;

const behavioursAt = (factor: number) => scaledSpec(SEED, factor).behaviours.length;
const charged = (shape: string, factor: number) => Math.round(costOf(shape, behavioursAt(factor)));
// Every map load costs this many milliseconds of fake CPU per behaviour, and is the product's.
const LOAD_PER_BEHAVIOUR = 700;
const loading = (factor: number) => LOAD_PER_BEHAVIOUR * behavioursAt(factor);

async function withEnv<T>(env: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function grown(shape: string): Promise<ScaleGrowth> {
  return withEnv(
    { METERED_SHAPE: shape, METERED_HARNESS_MS: '10000000', METERED_LOAD_MS: `${LOAD_PER_BEHAVIOUR}` },
    () => scaleGrowth(SEED, { factors: FACTORS, rounds: 3, generator: METERED }),
  );
}

function item(id: string) {
  const found = bankItems().find((entry) => entry.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
}

function dataWith(report: ScaleReport | undefined, growth?: ScaleGrowth): SeedData {
  return new SeedData(
    SEED,
    {},
    async () => {
      if (!report) throw new Error('this test measures no scale run');
      return report;
    },
    growth ? async () => growth : undefined,
  );
}

describe('the growth of the cost between two sizes, in one process', () => {
  it('times both sizes back to back, three rounds, and judges the best round', async () => {
    const report = await grown('linear');
    expect(report.error).toBeUndefined();
    expect([report.low, report.high, report.rounds]).toEqual([2, 20, 3]);
    // One map load and one generation per timed size; the harness's cleanup (10,000,000 ms each) is out.
    const low = charged('linear', 2) + loading(2);
    const high = charged('linear', 20) + loading(20);
    expect(report.lowMs).toEqual([low, low, low]);
    expect(report.highMs).toEqual([high, high, high]);
    // Ten times the behaviours cost ten times the time: the growth is 1.
    for (const ratio of report.ratios) expect(ratio).toBeCloseTo(1, 6);
    expect(report.ratio).toBe(Math.min(...report.ratios));
    expect(report.bound).toBe(SCALE_GROWTH_BOUND);
  }, 180_000);

  it('judges the fastest high time over the fastest low time: a disturbed size does not decide', async () => {
    const noisy = await grown('noisy');
    expect(noisy.error).toBeUndefined();
    // Round 1 pays three times at the low size, round 3 three times at the high size, round 2 nothing.
    const growth = (low: number, high: number) => high / low / (behavioursAt(20) / behavioursAt(2));
    const low = charged('linear', 2);
    const high = charged('linear', 20);
    const quiet = growth(low + loading(2), high + loading(20));
    expect(noisy.ratios[0]).toBeCloseTo(growth(3 * low + loading(2), high + loading(20)), 6);
    expect(noisy.ratios[1]).toBeCloseTo(quiet, 6);
    expect(noisy.ratios[2]).toBeCloseTo(growth(low + loading(2), 3 * high + loading(20)), 6);
    // The judged growth compares the fastest high time with the fastest low time: a disturbed size never decides.
    expect(noisy.ratio).toBeCloseTo(quiet, 6);
    expect(noisy.ratios[0]).toBeLessThan(quiet);
    expect(noisy.ratios[2]).toBeGreaterThan(SCALE_GROWTH_BOUND);
  }, 180_000);

  it('refuses a quadratic product whose low size is inflated by load in one round', async () => {
    const inflated = await grown('quadratic-inflated-low');
    expect(inflated.error).toBeUndefined();
    const low = charged('quadratic', 2) + loading(2);
    const high = charged('quadratic', 20) + loading(20);
    const quiet = high / low / (behavioursAt(20) / behavioursAt(2));
    // Round 1 paid five times at the low size: its own ratio looks like a linear product.
    expect(inflated.ratios[0]).toBeCloseTo(
      high / (5 * charged('quadratic', 2) + loading(2)) / (behavioursAt(20) / behavioursAt(2)),
      6,
    );
    expect(inflated.ratios[0]).toBeLessThan(SCALE_GROWTH_BOUND);
    // The judged growth compares the fastest high time with the fastest low time, so the inflated round
    // cannot make the product pass.
    expect(inflated.ratio).toBeCloseTo(quiet, 6);
    expect(inflated.ratio).toBeGreaterThan(SCALE_GROWTH_BOUND);
  }, 180_000);

  it('leaves a product that is twice as slow at every size to the absolute caps: its shape is linear', async () => {
    const slow = await grown('slow');
    expect(slow.error).toBeUndefined();
    expect(slow.lowMs[0]).toBe(2 * charged('linear', 2) + loading(2));
    expect(slow.highMs[0]).toBe(2 * charged('linear', 20) + loading(20));
    expect(slow.ratio).toBeCloseTo(1, 6);
  }, 180_000);

  it('refuses a quadratic product: the cost per behaviour grows with the behaviours', async () => {
    const quadratic = await grown('quadratic');
    expect(quadratic.error).toBeUndefined();
    // 20 over 2 is ten times the behaviours; a quadratic cost is a hundred times the time, ten times the cost
    // per behaviour, less the share of the map load, which is linear.
    const low = charged('quadratic', 2) + loading(2);
    const high = charged('quadratic', 20) + loading(20);
    expect(quadratic.ratio).toBeCloseTo(high / low / (behavioursAt(20) / behavioursAt(2)), 6);
    expect(quadratic.ratio).toBeGreaterThan(SCALE_GROWTH_BOUND);
  }, 180_000);

  it('allows a logarithmic factor on top of a linear product', async () => {
    const nlogn = await grown('nlogn');
    expect(nlogn.error).toBeUndefined();
    expect(nlogn.ratio).toBeGreaterThan(1);
    expect(nlogn.ratio).toBeLessThan(SCALE_GROWTH_BOUND);
  }, 180_000);

  it('reports a child that exits without a report as an error, never as a pass', async () => {
    const report = await withEnv({ METERED_SHAPE: 'no-such-shape' }, () =>
      scaleGrowth(SEED, { factors: FACTORS, rounds: 1, generator: METERED }),
    );
    expect(report.error).toMatch(/without a report/);
    expect(report.ratio).toBe(Number.POSITIVE_INFINITY);
  }, 180_000);
});

describe('the scale items', () => {
  const growth = { check: (data: SeedData) => item('scale.growth.linear').check(data) };
  const base = {
    seed: SEED,
    low: 10,
    high: 100,
    rounds: 3,
    bound: SCALE_GROWTH_BOUND,
    lowMs: [],
    highMs: [],
  };

  it('passes a linear product and fails a quadratic one, whatever the machine load', async () => {
    const linear = { ...base, ratios: [1.4, 1.1, 1.3], ratio: 1.1 };
    const verdict = await growth.check(dataWith(undefined, linear));
    expect(verdict.pass, verdict.detail).toBe(true);
    const quadratic = { ...base, ratios: [10.4, 9.8, 10.1], ratio: 9.8 };
    const refused = await growth.check(dataWith(undefined, quadratic));
    expect(refused.pass).toBe(false);
    expect(refused.detail).toContain('9.80');
    expect(refused.detail).toContain(`${SCALE_GROWTH_BOUND}`);
  });

  it('judges the best round: one round disturbed by the machine does not fail a linear product', async () => {
    const disturbed = { ...base, ratios: [7.9, 1.2, 6.5], ratio: 1.2 };
    expect((await growth.check(dataWith(undefined, disturbed))).pass).toBe(true);
    const slowEveryRound = { ...base, ratios: [7.9, 4.2, 6.5], ratio: 4.2 };
    expect((await growth.check(dataWith(undefined, slowEveryRound))).pass).toBe(false);
  });

  it('fails a run that did not finish, and a run nobody supplied', async () => {
    const error = { ...base, ratios: [], ratio: Number.POSITIVE_INFINITY, error: 'killed' };
    expect(await growth.check(dataWith(undefined, error))).toEqual({ pass: false, detail: 'killed' });
    expect((await growth.check(dataWith(undefined))).pass).toBe(false);
  });
});

describe('the scale time window holds the product only', () => {
  // Two real generations of seed 1 at the base size, on the fake meter. The harness (the child's cleanup) is
  // charged a hundred times the product's CPU, far above any cap: it is not the product's.
  const run = (shape: string, budget: number): Promise<ScaleReport> =>
    withEnv(
      {
        METERED_SHAPE: shape,
        METERED_REAL: '1',
        METERED_HARNESS_MS: '10000000',
        METERED_LOAD_MS: `${LOAD_PER_BEHAVIOUR}`,
      },
      () => scaleReport(1, SEED, budget, { generator: METERED }),
    );

  it('charges the map loads and the generations, never the harness, and passes its caps', async () => {
    const cost = charged('linear', 1);
    const report = await run('linear', 5 * cost);
    expect(report.error).toBeUndefined();
    expect(report).toMatchObject({ invalid: 0, bytesSame: true, graphOk: true });
    // Three map loads and two generations, nothing else: the cleanup is out.
    expect(report.ms).toBe(2 * cost + 3 * loading(1));
    const verdict = await item('scale.100x.time').check(dataWith(report));
    expect(verdict.pass, verdict.detail).toBe(true);
  }, 240_000);

  it('fails a product that is twice as slow at the same cap', async () => {
    const cost = charged('linear', 1);
    const report = await run('slow', 5 * cost);
    expect(report.error).toBeUndefined();
    expect(report.ms).toBe(2 * 2 * cost + 3 * loading(1));
    const verdict = await item('scale.100x.time').check(dataWith(report));
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toContain(`${report.ms} ms`);
  }, 240_000);
});
