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
    // A run of 1500 units: 52.5 s where a unit takes 35 ms, 157.5 s on a host three times slower.
    expect(await itemVerdict(100, report(100, 52_500, 35, 500))).toBe(true);
    expect(await itemVerdict(100, report(100, 157_500, 105, 500))).toBe(true);
    // A run of 1800 units fails on both hosts.
    expect(await itemVerdict(100, report(100, 63_000, 35, 500))).toBe(false);
    expect(await itemVerdict(100, report(100, 189_000, 105, 500))).toBe(false);
  });

  it('fail a product twice as slow and a quadratic one on the same host', async () => {
    // 1526 to 1679 units is the clean product at 100 times (validators/CONSTANTS.md); twice that fails.
    expect(await itemVerdict(100, report(100, 1679 * 35, 35, 500))).toBe(true);
    expect(await itemVerdict(100, report(100, 2 * 1526 * 35, 35, 500))).toBe(false);
    // A run that costs 100 times the 10 times run fails, though the 10 times run is well inside its own budget.
    expect(await itemVerdict(10, report(10, 200 * 35, 35, 80))).toBe(true);
    expect(await itemVerdict(100, report(100, 100 * 200 * 35, 35, 500))).toBe(false);
  });
});
