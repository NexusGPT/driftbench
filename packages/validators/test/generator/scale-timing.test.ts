import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scaleReport } from '../../src/ladders/generator/scale';

const BUDGET_MS = 8_000;
const METERED_FIRST_LOAD = fileURLToPath(new URL('./fixtures/metered-first-load.ts', import.meta.url));

describe('the scale CPU-time window', () => {
  it('counts the first product load inside the measured window', async () => {
    const report = await scaleReport(1, 1, BUDGET_MS, { generator: METERED_FIRST_LOAD });
    expect(report.error).toBeUndefined();
    expect(report).toMatchObject({ invalid: 0, lint: 0, bytesSame: true, graphOk: true });
    expect(report.followerTotal).toBeGreaterThan(0);
    expect(report.followerPass).toBe(report.followerTotal);
    // Only the first load advances the child's fake CPU meter, by exactly 5,000 ms. Starting the
    // window after that load reports zero. No real duration or difference between runs is an oracle.
    expect(report.ms).toBe(5_000);
  }, 180_000);
});
