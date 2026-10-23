import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { scaleReport } from '../../src/ladders/generator/scale';
import { calibrationOf, normalisedMs } from '../../src/ladders/generator/scale-calibration';

const BUSY = fileURLToPath(new URL('./fixtures/busy-after-run.ts', import.meta.url));

describe('a product that leaves a busy process behind after its run', () => {
  const folders: string[] = [];
  const pids: number[] = [];
  afterEach(() => {
    for (const pid of pids.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already ended
      }
    }
    delete process.env.DRIFTBENCH_BUSY_FILE;
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  it('gains nothing: the five calibrations were all taken before it started, and the time is not lowered', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'busy-after-run-'));
    folders.push(folder);
    const file = join(folder, 'pid');
    process.env.DRIFTBENCH_BUSY_FILE = file;
    const report = await scaleReport(1, 1, 8_000, { generator: BUSY });
    expect(report.error).toBeUndefined();
    // the planted product did leave a busy process
    expect(existsSync(file)).toBe(true);
    pids.push(Number(readFileSync(file, 'utf8')));
    // all five samples exist before the product could have run, so none of them is slowed by its leftover
    const runs = report.calibrationRunsMs ?? [];
    expect(runs).toHaveLength(5);
    expect(report.calibrationMs).toBe(calibrationOf(runs));
    expect(report.calibrationMs).toBeLessThanOrEqual(runs[0] as number);
    expect(report.normalisedMs).toBe(normalisedMs(report.ms, report.calibrationMs));
    expect(report.normalisedMs).toBeGreaterThanOrEqual(normalisedMs(report.ms, runs[0] as number));
  }, 180_000);
});
