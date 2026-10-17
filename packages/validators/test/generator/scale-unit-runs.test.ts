import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  SCALE_BUDGET_UNITS,
  SCALE_MIN_UNITS,
  SCALE_REFERENCE_UNIT_MS,
  type ScaleReport,
  scaleReport,
  timeVerdict,
} from '../../src/ladders/generator/scale';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const SLOW_HOST = fixture('slow-host.ts');
const SLOW_PRODUCT = fixture('slow-product.ts');
const QUADRATIC = fixture('quadratic-product.ts');
const WALL = 900_000;

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

describe('the time verdict in reference units', () => {
  it('fail when the unit was sampled fewer than the minimum times during the runs', () => {
    const [pass, detail] = timeVerdict(report(100, 1000, 35, SCALE_MIN_UNITS - 1));
    expect(pass).toBe(false);
    expect(detail).toMatch(/sampled 9 times/);
    expect(timeVerdict(report(100, 1000, 35, SCALE_MIN_UNITS))[0]).toBe(true);
  });

  it('keep the second budgets where a unit takes the reference time', () => {
    for (const [factor, units] of Object.entries(SCALE_BUDGET_UNITS)) {
      const seconds = (factor === '10' ? 30_000 : 60_000) / SCALE_REFERENCE_UNIT_MS;
      expect(units).toBe(Math.floor(seconds));
    }
  });
});

describe('the reference unit, measured beside a real scale run', () => {
  let plain: ScaleReport;
  // Measured values go to stderr, which the test runner always shows, so a CI log records the units.
  const units = (entry: ScaleReport) => entry.ms / entry.unitMs;
  beforeAll(async () => {
    plain = await scaleReport(10, 1, undefined);
  }, WALL);

  it(
    'leaves the units of a run on a host three times slower within reach of the plain run',
    async () => {
      const slow = await scaleReport(10, 1, undefined, { generator: SLOW_HOST, unitImport: SLOW_HOST });
      expect(plain.error).toBeUndefined();
      expect(slow.error).toBeUndefined();
      expect(plain.unitSamples).toBeGreaterThanOrEqual(SCALE_MIN_UNITS);
      expect(slow.unitSamples).toBeGreaterThanOrEqual(SCALE_MIN_UNITS);
      process.stderr.write(
        `plain ${plain.ms} ms, ${units(plain).toFixed(0)} units; slower host ${slow.ms} ms, ${units(slow).toFixed(0)} units\n`,
      );
      expect(slow.ms / plain.ms).toBeGreaterThan(2.4);
      const ratio = units(slow) / units(plain);
      expect(ratio).toBeGreaterThan(0.6);
      expect(ratio).toBeLessThan(1.6);
      expect(timeVerdict(slow)[0]).toBe(timeVerdict(plain)[0]);
    },
    WALL,
  );

  it(
    'runs the planted products: they cost more CPU time than the clean run, and the clean run passes at 10 times',
    async () => {
      const slow = await scaleReport(10, 1, undefined, { generator: SLOW_PRODUCT });
      process.stderr.write(
        `plain ${units(plain).toFixed(0)} units; twice as slow ${units(slow).toFixed(0)} units\n`,
      );
      // On a busy machine the unit does not follow the contention, so units of two runs minutes apart may not
      // compare (validators/CONSTANTS.md): this test reads CPU time. The verdicts at 100 times are read on the
      // CI runner, by the generator-scale job with plants.
      expect(slow.error).toBeUndefined();
      expect(slow.ms).toBeGreaterThan(plain.ms);
      process.env.DRIFTBENCH_QUADRATIC_US = '2';
      try {
        const quadratic = await scaleReport(10, 1, undefined, { generator: QUADRATIC });
        expect(quadratic.error).toBeUndefined();
        process.stderr.write(`quadratic ${quadratic.ms} ms, ${units(quadratic).toFixed(0)} units\n`);
        expect(timeVerdict(plain)[0]).toBe(true);
        expect(quadratic.ms).toBeGreaterThan(2 * plain.ms);
      } finally {
        delete process.env.DRIFTBENCH_QUADRATIC_US;
      }
    },
    WALL,
  );
});
