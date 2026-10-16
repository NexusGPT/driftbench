import { rmSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import type { PreparedMap } from '@agent-nexus/driftbench-generate';
import * as generator from '@agent-nexus/driftbench-generate';
import { costOf } from './metered-cost';

/**
 * A planted product for the scale tests, on a fake CPU meter. This module is imported in the isolated scale
 * child before its measurement starts. The meter starts at a nonzero baseline and advances only where this
 * module advances it, so no real duration, scheduling or host speed can change a reported time.
 *
 * Environment, read by the child (the test sets it before it spawns one):
 * - METERED_SHAPE: the cost of one generation as a function of the behaviours the map holds (metered-cost.ts).
 * - METERED_REAL=1: the product also does its real work, so the child can read its report and suites.
 * - METERED_HARNESS_MS: the fake CPU the harness's own cleanup (`rm` of the child's folder) costs.
 */

let user = 100_000;
let system = 200_000;
process.cpuUsage = (previous) => ({
  user: user - (previous?.user ?? 0),
  system: system - (previous?.system ?? 0),
});

/** Charges fake CPU, split between user and system time as a real process would show it. */
function advance(ms: number): void {
  user += Math.round(ms * 600);
  system += Math.round(ms * 400);
}

// A builtin's namespace is read-only, its CommonJS exports are not; the sync makes the child's own
// `import { rm }` see the wrapper.
const harness = Number(process.env.METERED_HARNESS_MS ?? 0);
if (harness > 0) {
  const fsPromises = createRequire(import.meta.url)('node:fs/promises') as typeof import('node:fs/promises');
  const real = fsPromises.rm;
  fsPromises.rm = async (...args: Parameters<typeof real>) => {
    advance(harness);
    return real(...args);
  };
  syncBuiltinESMExports();
}

export function generateSuiteToDisk(
  prepared: PreparedMap,
  options: { seed: number; mapPath: string; outputDir: string },
): { reportPath: string } {
  const behaviours =
    prepared.axisMap.dimensions.find((dimension) => dimension.kind === 'behaviour')?.values.length ?? 0;
  advance(costOf(process.env.METERED_SHAPE ?? 'linear', behaviours));
  if (process.env.METERED_REAL === '1')
    return (
      (generator as Record<string, unknown>).generateSuiteToDisk as (
        prepared: PreparedMap,
        options: { seed: number; mapPath: string; outputDir: string },
      ) => { reportPath: string }
    )(prepared, options);
  rmSync(options.outputDir, { recursive: true, force: true });
  return { reportPath: '' };
}
