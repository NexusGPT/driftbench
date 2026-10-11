/**
 * @driftbench/validators: code that proves the framework works. A validator plants a truth it knows, runs one
 * part of driftbench, and scores a ladder of levels with named failing items. Design: docs/validators.md.
 */
export const packageName = '@driftbench/validators';

export { type FormatOptions, formatLadder, showNumber } from './format';
export {
  type Direction,
  defineLadder,
  type Item,
  type Ladder,
  type LadderContext,
  type LadderReport,
  type LevelDef,
  type LevelRow,
  type Measure,
  passes,
  RESERVED_COMPONENTS,
  type RunOptions,
  runLadder,
  runSeeds,
  type SeedRun,
  type SeedSpec,
  seedLabel,
} from './ladder';
export { registeredLadders } from './ladders/index';
export { findRoot } from './root';
export {
  FALLBACK_HIDDEN_SEED,
  gitHead,
  type HeadReader,
  type HiddenSeed,
  hiddenSeed,
  MAX_SEEDS,
  parseSeeds,
  type SeedOptions,
  seedSpecs,
} from './seeds';
