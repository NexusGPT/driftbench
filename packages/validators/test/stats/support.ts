import { fileURLToPath } from 'node:url';
import * as stats from '@agent-nexus/driftbench-stats';
import { designsPath, readDesigns, type StatsDesigns } from '../../src/ladders/stats/index';

/** The repository root, where the ladder finds its fixtures. */
export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The committed designs of levels 3 to 6. */
export function committedDesigns(): StatsDesigns {
  return readDesigns(designsPath(ROOT));
}

/** The committed designs with some parts replaced, for a faster or a planted run. */
export function designsWith(change: (designs: StatsDesigns) => void): StatsDesigns {
  const designs = structuredClone(committedDesigns());
  change(designs);
  return designs;
}

/** The statistics functions as the ladder scores them. */
export const real = stats;

/** A long test: a level that simulates on the committed designs. */
export const SLOW = 120_000;
