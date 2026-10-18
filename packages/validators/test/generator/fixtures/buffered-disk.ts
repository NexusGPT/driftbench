/**
 * A planted product mutant for the scale test: a disk API that also keeps the whole suite in memory, as
 * an eager generation does. Its files are the same as the real disk API's; only its heap grows with the suite.
 */

import * as generator from '@agent-nexus/driftbench-generate';
import { generateSuite, type PreparedMap } from '@agent-nexus/driftbench-generate';

type ToDisk = (
  prepared: PreparedMap,
  options: { seed: number; mapPath: string; outputDir: string },
) => { reportPath: string };

const kept: unknown[] = [];

export function generateSuiteToDisk(
  prepared: PreparedMap,
  options: { seed: number; mapPath: string; outputDir: string },
): { reportPath: string } {
  kept.push(generateSuite(prepared, { seed: options.seed, mapPath: options.mapPath }).files);
  return ((generator as Record<string, unknown>).generateSuiteToDisk as ToDisk)(prepared, options);
}
