import { rmSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import type { PreparedMap } from '@agent-nexus/driftbench-generate';
import * as generator from '@agent-nexus/driftbench-generate';
import { loadApprovedMap as realLoadApprovedMap } from '@agent-nexus/driftbench-generate';
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
 * - METERED_LOAD_MS: the fake CPU every map load costs per behaviour of the map; the load is the product's.
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

export const loadApprovedMap: typeof realLoadApprovedMap = async (path) => {
  const loaded = await realLoadApprovedMap(path);
  if (loaded.ok) advance(Number(process.env.METERED_LOAD_MS ?? 0) * behavioursOf(loaded.prepared));
  return loaded;
};

function behavioursOf(prepared: PreparedMap): number {
  return prepared.axisMap.dimensions.find((dimension) => dimension.kind === 'behaviour')?.values.length ?? 0;
}

// The generations of this child so far, from 0: the untimed warm-up, then a low and a high size per round.
let calls = 0;
const DISTURBED = [1, 6];

export function generateSuiteToDisk(
  prepared: PreparedMap,
  options: { seed: number; mapPath: string; outputDir: string },
): { reportPath: string } {
  const behaviours = behavioursOf(prepared);
  // `noisy` is the linear product on a machine that disturbs single generations: the generations numbered
  // 1 (the low size of round 1) and 6 (the high size of round 3) cost three times as much; the rest cost 1.
  // `quadratic-inflated-low` is the quadratic product whose low size of round 1 (generation 1) costs five
  // times as much, as under a burst of load.
  const shape = process.env.METERED_SHAPE ?? 'linear';
  const disturbed = shape === 'noisy' && DISTURBED.includes(calls);
  const inflated = shape === 'quadratic-inflated-low' && calls === 1;
  const base = shape === 'noisy' ? 'linear' : shape === 'quadratic-inflated-low' ? 'quadratic' : shape;
  calls += 1;
  advance(costOf(base, behaviours) * (disturbed ? 3 : inflated ? 5 : 1));
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
