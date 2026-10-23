import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import type { PreparedMap } from '@agent-nexus/driftbench-generate';
import * as generator from '@agent-nexus/driftbench-generate';

type ToDisk = (
  prepared: PreparedMap,
  options: { seed: number; mapPath: string; outputDir: string },
) => { reportPath: string };

/**
 * A planted product mutant for the scale test: it generates as the real disk API does and, once its run is done, leaves
 * a busy process behind (the process burns CPU for a few seconds, then ends on its own). Anything measured on this
 * machine after the run would read slow. It writes the pid of the leftover to the file the test names.
 */
export function generateSuiteToDisk(
  prepared: PreparedMap,
  options: { seed: number; mapPath: string; outputDir: string },
): { reportPath: string } {
  const result = ((generator as Record<string, unknown>).generateSuiteToDisk as ToDisk)(prepared, options);
  const busy = spawn(
    process.execPath,
    ['-e', 'const end = Date.now() + 12000; while (Date.now() < end) {}'],
    { detached: true, stdio: 'ignore' },
  );
  busy.unref();
  const file = process.env.DRIFTBENCH_BUSY_FILE;
  if (file && busy.pid !== undefined) writeFileSync(file, String(busy.pid));
  return result;
}
