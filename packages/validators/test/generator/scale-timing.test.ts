import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scaleReport } from '../../src/ladders/generator/scale';

const BUDGET_MS = 8_000;
const SLOW_FIRST_LOAD = fileURLToPath(new URL('./fixtures/slow-first-load.ts', import.meta.url));

describe('the scale CPU-time window', () => {
  it('passes the correct reference at factor 1, seed 1', async () => {
    const report = await scaleReport(1, 1, BUDGET_MS);
    console.info(`correct reference: ${report.ms} ms CPU`);
    expect(report.error).toBeUndefined();
    expect(report.ms).toBeLessThanOrEqual(BUDGET_MS / 2);
  }, 80_000);

  it('fails the time predicate when only the first product load burns 5,000 ms CPU', async () => {
    const report = await scaleReport(1, 1, BUDGET_MS, { generator: SLOW_FIRST_LOAD });
    console.info(`first-load mutant: ${report.ms} ms CPU`);
    expect(report.error).toBeUndefined();
    expect(report.ms).toBeGreaterThanOrEqual(5_000);
    expect(report.ms <= BUDGET_MS / 2).toBe(false);
  }, 80_000);
});
