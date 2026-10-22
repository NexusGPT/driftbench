import { describe, expect, it } from 'vitest';
import { bankItems, SeedData } from '../../src/ladders/generator/bank';
import type { ScaleReport } from '../../src/ladders/generator/scale';
import {
  CALIBRATION_REFERENCE_MS,
  calibrate,
  calibrationRound,
  normalisedMs,
} from '../../src/ladders/generator/scale-calibration';

const REF = CALIBRATION_REFERENCE_MS;

/** A finished 100x report; only the timing fields matter to the time item. */
function report(ms: number, calibrationMs: number): ScaleReport {
  return {
    factor: 100,
    budgetMs: 120_000,
    ms,
    calibrationMs,
    referenceMs: REF,
    normalisedMs: normalisedMs(ms, calibrationMs),
    invalid: 0,
    lint: 0,
    bytesSame: true,
    graphOk: true,
    graphDetail: 'ok',
    twiseShare: 1,
    boundaryOk: true,
    boundaryMissing: 0,
    deviationOk: true,
    deviationMissing: 0,
    unwalked: 0,
    completeShare: 1,
    followerPass: 1,
    followerTotal: 1,
  };
}

async function timeItem(r: ScaleReport) {
  const item = bankItems().find((entry) => entry.id === 'scale.100x.time');
  if (!item) throw new Error('no scale.100x.time item');
  const data = new SeedData(1, {}, async () => r);
  return item.check(data);
}

describe('the calibration workload', () => {
  it('is deterministic: the same size gives the same checksum', () => {
    expect(calibrationRound(2_000)).toBe(calibrationRound(2_000));
    expect(calibrationRound(2_000)).not.toBe(calibrationRound(2_001));
  });

  it('reports a positive CPU time for a real workload', () => {
    expect(calibrate(1, 5_000)).toBeGreaterThanOrEqual(0);
  });
});

describe('the normalised CPU time', () => {
  it('equals the raw time on the reference machine', () => {
    expect(normalisedMs(61_234, REF)).toBe(61_234);
  });

  it('divides out a machine that runs the same work in twice the time', () => {
    expect(normalisedMs(120_000, 2 * REF)).toBe(60_000);
    expect(normalisedMs(30_000, REF / 2)).toBe(60_000);
  });

  it('leaves the raw time alone when the meter reports no calibration', () => {
    expect(normalisedMs(5_000, 0)).toBe(5_000);
  });
});

describe('scale.100x.time on a runner of any speed', () => {
  it('passes a product at the old speed on the reference machine, and fails 2x slower', async () => {
    expect((await timeItem(report(59_000, REF))).pass).toBe(true);
    expect((await timeItem(report(118_000, REF))).pass).toBe(false);
  });

  it('passes the same product on a runner that takes twice as long for everything', async () => {
    const verdict = await timeItem(report(98_000, 2 * REF));
    expect(verdict.pass, verdict.detail).toBe(true);
  });

  it('fails a product twice as slow on a fast runner that the raw budget would pass', async () => {
    // Raw 40,000 ms is under 60,000; on a runner twice as fast as the reference the work is 80,000 normalised.
    const verdict = await timeItem(report(40_000, REF / 2));
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toContain('40000 ms of CPU time (raw)');
    expect(verdict.detail).toContain('80000 ms normalised');
  });

  it('fails a product twice as slow on a slow runner, where the raw time is four times the budget', async () => {
    expect((await timeItem(report(236_000, 2 * REF))).pass).toBe(false);
  });
});
