import * as stats from '@agent-nexus/driftbench-stats';
import { defineLadder, type Ladder } from '../../ladder';
import {
  BANK_LEVELS,
  type BankItem,
  type BankLevel,
  type BankRun,
  levelMeasure,
  runInProcess,
  statsBank,
} from './bank/index';
import { runIsolated } from './bank/isolate';
import type { StatsImpl } from './reference';

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
  SHARES_LEVEL_MISSES,
  SHARES_NESTED_MISSES,
  SHARES_RECOVERY,
  SHARES_STREAM,
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
  /** Statistics functions replaced to plant a fault; the bank then runs in this process. */
  impl?: Partial<StatsImpl>;
  /** Only the items this keeps (tests); every item by default. */
  filter?: (item: BankItem) => boolean;
  /** Run the bank in this process instead of child processes (no protection against an endless loop). */
  inProcess?: boolean;
};

/** The ladder version this bank is (docs/validators.md section 12.5: floors are per ladder version). */
export const STATS_LADDER_VERSION = 2;

/** What each level of version 2 checks, for the table. */
const LEVEL_TEXT: Record<BankLevel, { name: string; metric: string }> = {
  reference: { name: 'reference values', metric: 'fixture groups matching scipy and numpy / groups' },
  degenerate: {
    name: 'degenerate inputs',
    metric: 'empty, NaN, infinite, out-of-domain, single and all-equal cases handled / cases',
  },
  reproducibility: {
    name: 'reproducibility',
    metric: 'same seed same bits, other seed other draw, order invariance / items',
  },
  analytic: {
    name: 'analytic truth',
    metric: 'estimators and tests matching a constructed truth, enumeration or textbook formula / items',
  },
  simulation: {
    name: 'simulation coverage',
    metric: 'planted designs whose coverage, recovery, error or power holds / designs',
  },
  scale: {
    name: 'scale and stability',
    metric: 'one-million-row calls under budget and shift-stable results / items',
  },
  roadmap: {
    name: 'roadmap methods',
    metric: 'methods the dossiers name, matching scipy, degenerate-safe, scaling / items',
  },
};

/**
 * The statistics validator, ladder version 2 (docs/validators.md sections 7 and 12): a bank of items in seven
 * sub-banks, each a level with threshold 1. A seed's whole bank runs once, in child processes that stop an item
 * past its budget, and each level reads its items from that run. Version 1's levels are its first items.
 */
export function statsLadder(options: StatsLadderOptions = {}): Ladder {
  const s: StatsImpl = { ...stats, ...options.impl };
  const inProcess = options.inProcess === true || options.impl !== undefined;
  const runs = new Map<string, Promise<{ items: BankItem[]; run: BankRun }>>();
  const seedRun = (seed: number, root: string) => {
    const key = `${seed}:${root}`;
    let pending = runs.get(key);
    if (!pending) {
      pending = (async () => {
        const items = statsBank(root).filter(options.filter ?? (() => true));
        const run = inProcess
          ? await runInProcess(items, seed, root, s)
          : await runIsolated(items, seed, root);
        return { items, run };
      })();
      runs.set(key, pending);
    }
    return pending;
  };
  return defineLadder({
    component: 'stats',
    version: STATS_LADDER_VERSION,
    levels: BANK_LEVELS.map((level) => ({
      id: level,
      name: LEVEL_TEXT[level].name,
      metric: LEVEL_TEXT[level].metric,
      threshold: 1,
      compute: async ({ seed, root }) => {
        const { items, run } = await seedRun(seed, root);
        return levelMeasure(
          items.filter((item) => item.level === level),
          run,
        );
      },
    })),
  });
}
