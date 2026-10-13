import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const BIN = join(ROOT, 'packages/cli/dist/bin.js');

type Row = { level: number; id: string; pass: boolean };
type Report = { component: string; level: number; seeds: { seed: number; level: number; rows: Row[] }[] };

/**
 * Builds the JavaScript of every package with the package's own build command, less the type declarations
 * (they never run) and less `--clean` (declarations a full build wrote stay in place).
 */
function buildJavaScript(): void {
  for (const name of readdirSync(join(ROOT, 'packages')).sort()) {
    const folder = join(ROOT, 'packages', name);
    let command: unknown;
    try {
      command = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).scripts?.build;
    } catch {
      continue;
    }
    if (typeof command !== 'string' || !command.startsWith('tsup ')) continue;
    const words = command.split(' ').filter((word) => word !== '--dts' && word !== '--clean');
    const built = spawnSync('pnpm', ['exec', ...words, '--silent'], { cwd: folder, encoding: 'utf8' });
    if (built.status !== 0) throw new Error(`building ${name} failed\n${built.stdout}\n${built.stderr}`);
  }
}

/** The built CLI, as an installed package runs it: plain Node.js, no tsx. */
function driftbench(args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
}

describe('the built CLI', () => {
  beforeAll(buildJavaScript, 600_000);

  it('runs validate on the statistics ladder: every bank child starts and reports its items', () => {
    const run = driftbench(['validate', 'stats', '--seed', '1', '--json']);
    expect(run.stdout).not.toMatch(/child process (died|did not start)/);
    const report = JSON.parse(run.stdout) as Report;
    expect(report.component).toBe('stats');
    // Level 1 compares the package with fixed reference values: it needs the child, and never the clock.
    expect(report.seeds[0]?.rows.find((row) => row.level === 1)).toMatchObject({
      id: 'reference',
      pass: true,
    });
    expect(report.level).toBeGreaterThanOrEqual(1);
  }, 600_000);
});
