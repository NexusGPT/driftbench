import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scaleReport } from '../../src/ladders/generator/scale';

const BUDGET_MS = 8_000;
const SLOW_FIRST_LOAD = fileURLToPath(new URL('./fixtures/slow-first-load.ts', import.meta.url));

describe('the scale CPU-time window', () => {
  it('counts the CPU delay in the first product load', async () => {
    const reference = await scaleReport(1, 1, BUDGET_MS);
    const mutant = await scaleReport(1, 1, BUDGET_MS, { generator: SLOW_FIRST_LOAD });
    console.info(`reference: ${reference.ms} ms CPU; first-load mutant: ${mutant.ms} ms CPU`);
    for (const report of [reference, mutant]) {
      expect(report.error).toBeUndefined();
      expect(report).toMatchObject({ invalid: 0, lint: 0, bytesSame: true, graphOk: true });
      expect(report.followerTotal).toBeGreaterThan(0);
      expect(report.followerPass).toBe(report.followerTotal);
    }
    // Compare on the same host: a correct reference can exceed the reduced 4,000 ms budget on slower
    // runners. The old window missed this first-load cost; allow 20% CPU variation between the runs.
    expect(mutant.ms - reference.ms).toBeGreaterThanOrEqual(0.8 * 5_000);
  }, 180_000);
});
