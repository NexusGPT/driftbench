import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as stats from '@driftbench/stats';
import { defineLadder, type Ladder } from '../../ladder';
import { CLUSTERED_COVERAGE, clusteredLevel } from './clustered';
import { designsPath, readDesigns, type StatsDesigns } from './designs';
import { POWER_GAP, powerLevel } from './power';
import { type Row, referenceLevel, STATS_FIXTURES, type StatsImpl } from './reference';
import { type PilotAnalyser, SHARES_RECOVERY, sharesLevel } from './shares';
import { type CompletenessLine, UNSEEN_ERROR, unseenLevel } from './unseen';
import { WILSON_COVERAGE, wilsonLevel } from './wilson';

export { CLUSTERED_COMPONENT, CLUSTERED_COVERAGE, clusteredLevel } from './clustered';
export {
  type ClusteredDesigns,
  designsPath,
  type PowerDesigns,
  readDesigns,
  type SharesDesign,
  STATS_DESIGNS,
  type StatsDesigns,
  StatsDesignsSchema,
  type UnseenDesigns,
} from './designs';
export { clusterOutcomes, generator, normal, salt } from './draw';
export { POWER_COMPONENT, POWER_GAP, powerLevel } from './power';
export {
  REFERENCE_TOLERANCE,
  referenceCases,
  referenceLevel,
  STATS_COMPONENTS,
  STATS_FIXTURES,
  type StatsImpl,
} from './reference';
export {
  type PilotAnalyser,
  plantedShares,
  plantShares,
  SHARE_LEVELS,
  SHARES_COMPONENT,
  SHARES_RECOVERY,
  type SharesDataset,
  sharesLevel,
} from './shares';
export {
  type CompletenessLine,
  type Population,
  plantPopulation,
  UNSEEN_COMPONENTS,
  UNSEEN_ERROR,
  unseenLevel,
} from './unseen';
export { WILSON_COVERAGE, WILSON_DRAWS, WILSON_RATES, WILSON_SIZES, wilsonLevel } from './wilson';

export type StatsLadderOptions = {
  impl?: Partial<StatsImpl>;
  /** The fixtures file; by default STATS_FIXTURES under the run's root. */
  fixtures?: string;
  /** The planted designs of levels 3 to 6; by default STATS_DESIGNS under the run's root. */
  designs?: StatsDesigns;
  /** The pilot analysis level 4 scores; by default `analysePilot` of the generate package. */
  analysePilot?: PilotAnalyser;
  /** The completeness line level 5 scores; by default `completeness` of the space package. */
  completeness?: CompletenessLine;
};

/**
 * The statistics validator (docs/validators.md section 7). Level 1: every Python reference value matches to
 * 1e-6. Level 2: Wilson coverage at least 0.93 at n of 20, 50 and 200 over 1000 draws per seed. Level 3: the
 * clustered bootstrap covers at least 0.93 on clustered data, where the naive interval falls below the bar.
 * Level 4: the pilot analysis puts at least 0.93 of the planted variance shares inside their bootstrap interval,
 * over 8 planted datasets. Level 5: above the class count the sample coverage estimates err by less than 10
 * percent on average, and below it the completeness line refuses the estimate with a warning on every draw.
 * Level 6: at the minimum detectable effect, the simulated power is within 5 points of the power planned.
 */
export function statsLadder(options: StatsLadderOptions = {}): Ladder {
  const s: StatsImpl = { ...stats, ...options.impl };
  let cached: { path: string; data: Row } | undefined;
  const load = (root: string): Row => {
    const path = options.fixtures ?? join(root, STATS_FIXTURES);
    if (cached?.path !== path) cached = { path, data: JSON.parse(readFileSync(path, 'utf8')) as Row };
    return cached.data;
  };
  let planted: { root: string; designs: StatsDesigns } | undefined;
  const designs = (root: string): StatsDesigns => {
    if (options.designs) return options.designs;
    if (planted?.root !== root) planted = { root, designs: readDesigns(designsPath(root)) };
    return planted.designs;
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
      {
        id: 'clustered-coverage',
        name: 'clustered bootstrap coverage',
        metric:
          'clustered intervals containing the truth / intervals computed, pooled over the designs; 0 when the naive interval reaches the bar on a design',
        threshold: CLUSTERED_COVERAGE,
        compute: ({ seed, root }) => clusteredLevel(seed, s, designs(root).clustered),
      },
      {
        id: 'variance-shares',
        name: 'variance share recovery',
        metric:
          'planted shares inside their bootstrap interval / shares planted, 4 levels on each of 8 datasets',
        threshold: SHARES_RECOVERY,
        compute: ({ seed, root }) => sharesLevel(seed, designs(root).shares, options.analysePilot),
      },
      {
        id: 'unseen-mass',
        name: 'unseen mass',
        metric:
          'mean |estimated - true coverage| / true coverage above the class count, worst estimator and population; 1 when a draw below it gets no warning',
        threshold: UNSEEN_ERROR,
        direction: 'atMost',
        compute: ({ seed, root }) => unseenLevel(seed, s, designs(root).unseen, options.completeness),
      },
      {
        id: 'mde-power',
        name: 'minimum detectable effect power',
        metric:
          '|predicted power - campaigns detecting the planted effect / campaigns simulated|, largest over the designs',
        threshold: POWER_GAP,
        direction: 'atMost',
        compute: ({ seed, root }) => powerLevel(seed, s, designs(root).power),
      },
    ],
  });
}
