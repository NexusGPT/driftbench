import { describe, expect, it } from 'vitest';
import { bankItems, SeedData } from '../../src/ladders/generator/bank';
import type { ScaleReport } from '../../src/ladders/generator/scale';

// The bank's own time items on hand-written reports: a run's verdict is the same on a host three times slower,
// and a product twice as slow or quadratic fails. Each report holds the reference unit's mean and samples.

/** A finished scale report with everything right but the time, which the case sets. */
function report(factor: number, ms: number, unitMs: number, unitSamples: number): ScaleReport {
  return {
    factor,
    budgetMs: factor === 10 ? 60_000 : 120_000,
    ms,
    invalid: 0,
    lint: 0,
    bytesSame: true,
    graphOk: true,
    graphDetail: '',
    twiseShare: 1,
    boundaryOk: true,
    boundaryMissing: 0,
    deviationOk: true,
    deviationMissing: 0,
    unwalked: 0,
    completeShare: 1,
    followerPass: 1,
    followerTotal: 1,
    unitMs,
    unitSamples,
  };
}

/** The verdict of the bank's own time item on a report. */
async function itemVerdict(factor: number, scaled: ScaleReport): Promise<boolean> {
  const item = bankItems().find((entry) => entry.id === `scale.${factor}x.time`);
  if (!item) throw new Error(`no item scale.${factor}x.time`);
  const data = new SeedData(1, {}, async () => scaled);
  return (await item.check(data)).pass;
}

describe('the scale time items count CPU time in reference units', () => {
  it('give the same verdict on a host three times slower, where the unit costs three times as much', async () => {
    // A run of 1100 units: 56.4 s where a unit takes 51.3 ms, 169.3 s on a host three times slower.
    expect(await itemVerdict(100, report(100, 1100 * 51.3, 51.3, 170))).toBe(true);
    expect(await itemVerdict(100, report(100, 1100 * 153.9, 153.9, 170))).toBe(true);
    // A run of 1300 units fails on both hosts.
    expect(await itemVerdict(100, report(100, 1300 * 51.3, 51.3, 170))).toBe(false);
    expect(await itemVerdict(100, report(100, 1300 * 153.9, 153.9, 170))).toBe(false);
  });

  it('give the same verdict on runners as far apart as the CI runners measured', async () => {
    // 1097 units on a runner where a unit took 65.1 ms (72.8 s) and on one where it took 30.8 ms (37.5 s).
    expect(await itemVerdict(100, report(100, 1097 * 65.1, 65.1, 170))).toBe(true);
    expect(await itemVerdict(100, report(100, 1097 * 30.8, 30.8, 176))).toBe(true);
  });

  it('judge the 10 times run by the unit of the 100 times run, which a short window reads dearer', async () => {
    // A product at 33 s at 10 times, the earlier absolute item's failure, on a runner whose unit takes 51.3 ms
    // over the long 100 times window and 70 ms over the short 10 times one (as the CI runner reads it).
    const ten = report(10, 33_000, 70, 20);
    const hundred = report(100, 1100 * 51.3, 51.3, 170);
    const item = bankItems().find((entry) => entry.id === 'scale.10x.time');
    if (!item) throw new Error('no item scale.10x.time');
    const verdict = await item.check(new SeedData(1, {}, async (factor) => (factor === 10 ? ten : hundred)));
    // 33000 ms over 51.3 ms is 643 units, over the budget of 584; read in its own window it would be 471.
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toMatch(/643 reference units .* during the 100 times runs/);
  });

  it('fail a product twice as slow and a quadratic one on the same host', async () => {
    // 1097 units is the lowest clean run on the runner (validators/CONSTANTS.md); twice that fails.
    expect(await itemVerdict(100, report(100, 1097 * 51.3, 51.3, 170))).toBe(true);
    expect(await itemVerdict(100, report(100, 2 * 1097 * 51.3, 51.3, 170))).toBe(false);
    // A run that costs 100 times the 10 times run fails, though the 10 times run is well inside its own budget.
    expect(await itemVerdict(10, report(10, 160 * 51.3, 51.3, 20))).toBe(true);
    expect(await itemVerdict(100, report(100, 100 * 160 * 51.3, 51.3, 170))).toBe(false);
  });
});
