/**
 * @driftbench/validators: code that proves the framework works. A validator plants a truth it knows, runs one
 * part of driftbench, and scores a ladder of levels with named failing items. Design: docs/validators.md.
 */
export const packageName = '@driftbench/validators';

export {
  type BankRow,
  type BankSummary,
  type BankVerdict,
  bankSummary,
  formatItems,
  LEVEL_FAMILY,
  NO_FAMILY,
  NO_TIER,
} from './bank';
export { type BriefInput, composeBrief, EXECUTOR_FILE } from './brief';
export {
  checkFloors,
  emptyFloors,
  FLOORS_FILE,
  type FloorCheck,
  type FloorEvidence,
  type FloorHistoryEntry,
  type FloorsFile,
  FloorsFileSchema,
  floorNote,
  floorOf,
  migrateFloors,
  type RaiseRequest,
  raiseFloor,
  readFloors,
  writeFloors,
} from './floors';
export { type FormatOptions, formatLadder, itemLines, showNumber } from './format';
export {
  checkHandover,
  HANDOVER_SECTIONS,
  handoverFile,
  handoverSection,
  handoverTemplate,
  levelTable,
  parseLevelTable,
  readHandover,
  researchFile,
  researchTemplate,
  setLevelTable,
  writeHandover,
} from './handover';
export {
  BANK_MIN_FAMILY,
  BANK_MIN_SIZE,
  formatHardness,
  HARDNESS_MAX_SCORE,
  HARDNESS_MIN_FORECAST,
  type Hardness,
  measureHardness,
} from './hardness';
export {
  appendJournal,
  type JournalRow,
  JournalRowSchema,
  journalFile,
  loopFolder,
  PILOT_ITERATIONS,
  readJournal,
  validateRow,
} from './journal';
export {
  type BankEntry,
  bankMeasure,
  type Direction,
  defineLadder,
  type Item,
  type Ladder,
  type LadderContext,
  type LadderReport,
  type LevelDef,
  type LevelRow,
  ladderVersion,
  type Measure,
  passes,
  RESERVED_COMPONENTS,
  type RunOptions,
  runLadder,
  runSeeds,
  type SeedRun,
  type SeedSpec,
  seedLabel,
  type Tier,
} from './ladder';
export { registeredLadders } from './ladders/index';
export {
  REFERENCE_TOLERANCE,
  referenceCases,
  referenceLevel,
  STATS_COMPONENTS,
  STATS_FIXTURES,
  type StatsImpl,
  type StatsLadderOptions,
  statsLadder,
  WILSON_COVERAGE,
  WILSON_DRAWS,
  WILSON_RATES,
  WILSON_SIZES,
  wilsonLevel,
} from './ladders/stats';
export {
  type DiffReader,
  EXECUTOR_BRANCH_PREFIX,
  gitChangedFiles,
  PROTECTED_PATHS,
  protectedChanges,
} from './protect';
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
