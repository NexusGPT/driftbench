import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bankItems, SeedData } from '../../src/ladders/generator/bank';
import { type ScaleReport, scaleReport } from '../../src/ladders/generator/scale';
import {
  CALIBRATION_MAX_CREDIT,
  CALIBRATION_REFERENCE_MS,
  calibrate,
  calibrationFactor,
  calibrationRound,
  normalisedMs,
} from '../../src/ladders/generator/scale-calibration';

const ORDER = fileURLToPath(new URL('./fixtures/calibration-order.ts', import.meta.url));
const CHILD = fileURLToPath(new URL('../../src/ladders/generator/scale-child.ts', import.meta.url));
const SCALE = fileURLToPath(new URL('../../src/ladders/generator/scale.ts', import.meta.url));

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
    creditCapped: calibrationFactor(calibrationMs).capped,
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

  it('divides out a machine that is slower, up to the cap on its credit', () => {
    expect(normalisedMs(72_000, 1.2 * REF)).toBe(60_000);
    expect(calibrationFactor(1.2 * REF).capped).toBe(false);
  });

  it('caps the credit of a runner more than 1.5 times slower than the reference, and says so', () => {
    expect(calibrationFactor(2 * REF)).toEqual({ factor: 1 / CALIBRATION_MAX_CREDIT, capped: true });
    expect(normalisedMs(120_000, 2 * REF)).toBe(80_000);
    expect(normalisedMs(120_000, 10 * REF)).toBe(80_000);
  });

  it('multiplies the time of a faster machine, with no cap', () => {
    expect(normalisedMs(30_000, REF / 2)).toBe(60_000);
    expect(calibrationFactor(REF / 4).capped).toBe(false);
  });

  it('leaves the raw time alone when the meter reports no calibration', () => {
    expect(normalisedMs(5_000, 0)).toBe(5_000);
    expect(calibrationFactor(0)).toEqual({ factor: 1, capped: false });
  });
});

describe('scale.100x.time on a runner of any speed', () => {
  it('passes a product at the old speed on the reference machine, and fails 2x slower', async () => {
    expect((await timeItem(report(59_000, REF))).pass).toBe(true);
    expect((await timeItem(report(118_000, REF))).pass).toBe(false);
  });

  it('passes the same product on a runner that takes 1.4 times as long for everything', async () => {
    const verdict = await timeItem(report(83_000, 1.4 * REF));
    expect(verdict.pass, verdict.detail).toBe(true);
    expect(verdict.detail).not.toContain('capped');
  });

  it('caps the credit of a very slow runner, and the detail says so', async () => {
    // Raw 98,000 ms on a runner 2 times slower would be 49,000 uncapped; the cap makes it 65,333.
    const verdict = await timeItem(report(98_000, 2 * REF));
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toContain('capped');
    expect(verdict.detail).toContain('65333 ms normalised');
  });

  it('fails a product twice as slow on a fast runner that the raw budget would pass', async () => {
    // Raw 40,000 ms is under 60,000; on a runner twice as fast as the reference it is 80,000 normalised.
    const verdict = await timeItem(report(40_000, REF / 2));
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toContain('40000 ms of CPU time (raw)');
    expect(verdict.detail).toContain('80000 ms normalised');
  });

  it('fails a product twice as slow on a slow runner, whose raw time is far over', async () => {
    expect((await timeItem(report(236_000, 2 * REF))).pass).toBe(false);
  });
});

describe('the calibration is measured in a process of its own, before the timed child', () => {
  it('keeps the calibration out of the timed child: it imports no calibration code', () => {
    const child = readFileSync(CHILD, 'utf8');
    expect(child).not.toMatch(/calibrate\(/);
    expect(child).toContain('CALIBRATION_ENV');
    const parent = readFileSync(SCALE, 'utf8');
    const measured = parent.indexOf('await measureCalibration()');
    expect(measured).toBeGreaterThan(-1);
    expect(measured).toBeLessThan(parent.indexOf("'--import'", measured));
  });

  it('hands the timed child the calibration it saw measured, before the override module is imported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'calibration-order-'));
    const file = join(dir, 'seen.txt');
    process.env.DRIFTBENCH_ORDER_FILE = file;
    try {
      const report = await scaleReport(1, 1, 8_000, { generator: ORDER });
      expect(report.error).toBeUndefined();
      const seen = Number(readFileSync(file, 'utf8'));
      expect(seen).toBeGreaterThan(0);
      expect(Math.abs(seen - report.calibrationMs)).toBeLessThan(0.1);
    } finally {
      delete process.env.DRIFTBENCH_ORDER_FILE;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it('runs the timed child under a small heap with the calibration measured outside it', async () => {
    const report = await scaleReport(1, 1, 600_000, { heapMb: 128 });
    expect(report.error).toBeUndefined();
    expect(report.calibrationMs).toBeGreaterThan(0);
  }, 300_000);
});
