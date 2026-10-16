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
  return withEnv({ METERED_SHAPE: shape }, () =>
    scaleGrowth(SEED, { factors: FACTORS, rounds: 3, generator: METERED }),
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
    expect(report.lowMs).toEqual([charged('linear', 2), charged('linear', 2), charged('linear', 2)]);
    expect(report.highMs).toEqual([charged('linear', 20), charged('linear', 20), charged('linear', 20)]);
    // Ten times the behaviours cost ten times the time: the growth is 1.
    for (const ratio of report.ratios) expect(ratio).toBeCloseTo(1, 6);
    expect(report.ratio).toBe(Math.min(...report.ratios));
    expect(report.bound).toBe(SCALE_GROWTH_BOUND);
  }, 180_000);

  it('judges the best of the rounds: a disturbed low size or high size does not decide', async () => {
    const noisy = await grown('noisy');
    expect(noisy.error).toBeUndefined();
    // Round 1 pays three times at the low size, round 3 three times at the high size, round 2 nothing.
    expect(noisy.ratios[0]).toBeCloseTo(1 / 3, 6);
    expect(noisy.ratios[1]).toBeCloseTo(1, 6);
    expect(noisy.ratios[2]).toBeCloseTo(3, 6);
    expect(noisy.ratio).toBeCloseTo(1 / 3, 6);
    expect(Math.max(...noisy.ratios)).toBeGreaterThan(SCALE_GROWTH_BOUND);
  }, 180_000);

  it('leaves a product that is twice as slow at every size to the absolute caps: its shape is linear', async () => {
    const slow = await grown('slow');
    expect(slow.error).toBeUndefined();
    expect(slow.lowMs[0]).toBe(2 * charged('linear', 2));
    expect(slow.highMs[0]).toBe(2 * charged('linear', 20));
    expect(slow.ratio).toBeCloseTo(1, 6);
  }, 180_000);

  it('refuses a quadratic product: the cost per behaviour grows with the behaviours', async () => {
    const quadratic = await grown('quadratic');
    expect(quadratic.error).toBeUndefined();
    // 20 over 2 is ten times the behaviours; a quadratic cost is a hundred times the time, ten times the cost per behaviour.
    expect(quadratic.ratio).toBeCloseTo(10, 6);
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
  // One real generation of seed 1 at the base size, on the fake meter. The harness (the child's cleanup) is
  // charged a hundred times the product's CPU, far above any cap: it is not the product's.
  const run = (shape: string, budget: number): Promise<ScaleReport> =>
    withEnv({ METERED_SHAPE: shape, METERED_REAL: '1', METERED_HARNESS_MS: '10000000' }, () =>
      scaleReport(1, SEED, budget, { generator: METERED }),
    );

  it('charges the map loads and the generations, never the harness, and passes its caps', async () => {
    const cost = charged('linear', 1);
    const report = await run('linear', 5 * cost);
    expect(report.error).toBeUndefined();
    expect(report).toMatchObject({ invalid: 0, bytesSame: true, graphOk: true });
    // Two generations, nothing else: the cleanup is out.
    expect(report.ms).toBe(2 * cost);
    const verdict = await item('scale.100x.time').check(dataWith(report));
    expect(verdict.pass, verdict.detail).toBe(true);
  }, 240_000);

  it('fails a product that is twice as slow at the same cap', async () => {
    const cost = charged('linear', 1);
    const report = await run('slow', 5 * cost);
    expect(report.error).toBeUndefined();
    expect(report.ms).toBe(2 * 2 * cost);
    const verdict = await item('scale.100x.time').check(dataWith(report));
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toContain(`${report.ms} ms`);
  }, 240_000);
});
