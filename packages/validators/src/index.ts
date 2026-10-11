/**
 * @driftbench/validators: code that proves the framework works. A validator plants a truth it knows, runs one
 * part of driftbench, and scores a ladder of levels with named failing items. Design: docs/validators.md.
 */
export const packageName = '@driftbench/validators';

export { type BriefInput, composeBrief, EXECUTOR_FILE } from './brief';
export {
  checkFloors,
  FLOORS_FILE,
  type FloorCheck,
  type FloorEvidence,
  type FloorsFile,
  FloorsFileSchema,
  floorOf,
  type RaiseRequest,
  raiseFloor,
  readFloors,
  writeFloors,
} from './floors';
export { type FormatOptions, formatLadder, showNumber } from './format';
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
  appendJournal,
  type JournalRow,
  JournalRowSchema,
  journalFile,
  loopFolder,
  readJournal,
  validateRow,
} from './journal';
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
