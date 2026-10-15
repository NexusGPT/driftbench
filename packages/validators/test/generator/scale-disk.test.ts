import { fileURLToPath } from 'node:url';
import * as generator from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { scaleReport } from '../../src/ladders/generator/index';

// The scale child runs the generator's disk API when the package exports it (docs/generating.md, "Streaming
// generation to disk"). Ten times the behaviours of seed 1 under a 128 MB heap: the eager suite does not fit
// there, the disk API does. The mutant writes the same files but keeps the whole suite in memory.
const hasDisk = typeof (generator as Record<string, unknown>).generateSuiteToDisk === 'function';
const BUDGET = 600_000;
const HEAP_MB = 128;
const BUFFERED = fileURLToPath(new URL('./fixtures/buffered-disk.ts', import.meta.url));

describe.skipIf(!hasDisk)('the scale child on the disk API', () => {
  it(
    'finishes ten times the behaviours under a small heap, with every scale field met',
    async () => {
      const report = await scaleReport(10, 1, BUDGET, { heapMb: HEAP_MB });
      expect(report.error).toBeUndefined();
      expect(report).toMatchObject({
        invalid: 0,
        lint: 0,
        bytesSame: true,
        graphOk: true,
        twiseShare: 1,
        boundaryOk: true,
        deviationOk: true,
        unwalked: 0,
      });
      expect(report.followerPass).toBe(report.followerTotal);
    },
    BUDGET,
  );

  it(
    'fails a disk API that keeps the whole suite in memory',
    async () => {
      const report = await scaleReport(10, 1, BUDGET, { heapMb: HEAP_MB, generator: BUFFERED });
      expect(report.error).toMatch(/without a report/);
    },
    BUDGET,
  );
});
