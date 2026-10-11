import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as stats from '@driftbench/stats';
import { defineLadder, type Ladder } from '../../ladder';
import { type Row, referenceLevel, STATS_FIXTURES, type StatsImpl } from './reference';
import { WILSON_COVERAGE, wilsonLevel } from './wilson';

export { clusterOutcomes, generator, normal, salt } from './draw';
export {
  REFERENCE_TOLERANCE,
  referenceCases,
  referenceLevel,
  STATS_COMPONENTS,
  STATS_FIXTURES,
  type StatsImpl,
} from './reference';
export { WILSON_COVERAGE, WILSON_DRAWS, WILSON_RATES, WILSON_SIZES, wilsonLevel } from './wilson';

export type StatsLadderOptions = {
  impl?: Partial<StatsImpl>;
  /** The fixtures file; by default STATS_FIXTURES under the run's root. */
  fixtures?: string;
};

/**
 * The statistics validator (docs/validators.md section 7). Level 1: every Python reference value matches to
 * 1e-6. Level 2: Wilson coverage at least 0.93 at n of 20, 50 and 200 over 1000 draws per seed.
 */
export function statsLadder(options: StatsLadderOptions = {}): Ladder {
  const s: StatsImpl = { ...stats, ...options.impl };
  let cached: { path: string; data: Row } | undefined;
  const load = (root: string): Row => {
    const path = options.fixtures ?? join(root, STATS_FIXTURES);
    if (cached?.path !== path) cached = { path, data: JSON.parse(readFileSync(path, 'utf8')) as Row };
    return cached.data;
  };
  return defineLadder({
    component: 'stats',
    levels: [
      {
        id: 'reference-values',
        name: 'reference values',
        metric: 'fixture cases matched / fixture cases compared',
        threshold: 1,
        compute: ({ root }) => referenceLevel(load(root), s),
      },
      {
        id: 'wilson-coverage',
        name: 'Wilson coverage',
        metric: 'intervals containing the truth / intervals computed, lowest over n of 20, 50, 200',
        threshold: WILSON_COVERAGE,
        compute: ({ seed }) => wilsonLevel(seed, s),
      },
    ],
  });
}
