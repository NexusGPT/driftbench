import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildJavaScript } from '../../../tools/test-build';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'built-validate-'));
const BIN = join(scratch, 'cli/dist/bin.js');
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type Row = { level: number; id: string; pass: boolean | null };
type Report = { component: string; level: number; seeds: { seed: number; level: number; rows: Row[] }[] };

/** The built CLI, as an installed package runs it: plain Node.js, no tsx. */
function driftbench(args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
}

describe('the built CLI', () => {
  beforeAll(() => buildJavaScript(ROOT, scratch), 600_000);

  it('runs validate on the statistics ladder: every bank child starts and reports its items', () => {
    // Level 1 alone: a slice runs the bank items of its levels only. The whole ladder runs per seed in the
    // validators workflow, so this test does not run the whole bank under the frame (about 600 s).
    const run = driftbench(['validate', 'stats', '--seed', '1', '--levels', '1..1', '--json']);
    expect(run.stdout).not.toMatch(/child process (died|did not start)/);
    const report = JSON.parse(run.stdout) as Report;
    expect(report.component).toBe('stats');
    // Level 1 compares the package with fixed reference values: it needs the child, and never the clock.
    expect(report.seeds[0]?.rows.find((row) => row.level === 1)).toMatchObject({
      id: 'reference',
      pass: true,
    });
    expect(report.level).toBeGreaterThanOrEqual(1);
    // The levels above the slice are listed and not computed.
    expect(report.seeds[0]?.rows.filter((row) => row.level > 1).every((row) => row.pass === null)).toBe(true);
  }, 600_000);
});
