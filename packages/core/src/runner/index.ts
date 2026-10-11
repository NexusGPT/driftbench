/**
 * The runner: runs a spec through an adapter, block by block, in free-running mode; plans and runs
 * campaigns; compares transcripts for the determinism smoke test.
 */
export {
  compareEndState,
  deepEqual,
  type EndStateDiff,
  type EndStateMatch,
  matchAssertion,
} from './assertion';
export {
  type BlockKeyParts,
  blockCacheKey,
  endStateCacheKey,
  type ObservedCache,
  unwrapEndState,
  wrapEndState,
} from './cache';
export {
  type CampaignPlan,
  type CampaignRunOptions,
  type CellOutcome,
  type CostLine,
  cellIdOf,
  type MinimumDetectableEffect,
  minimumDetectableEffect,
  outcomeOf,
  type PlannedCell,
  type PlanOptions,
  planCampaign,
  runCampaign,
  runsByCell,
} from './campaign';
export { type CellKey, cellId } from './cell';
export {
  type CompoundingBlock,
  type CompoundingIndex,
  type CompoundingLine,
  compoundingIndex,
  type IntervalEstimate,
  type IntervalFn,
  isDriverInjected,
  specBlocks,
} from './compounding';
export { DRIFT_BY_FAMILY, driftOf } from './drift';
export {
  addFacts,
  assistantMessage,
  canonicalGiven,
  canonicalReply,
  enterBlock,
  initialGiven,
  mergeWorld,
  type RunningGiven,
  resolveGiven,
  stimulusMessages,
} from './given';
export {
  describeContradiction,
  type LedgerContradiction,
  ledgerContradictions,
  ledgerVerdicts,
} from './ledger';
export { CallFailure, describeError, isTransportError, type RetryOptions, withRetry } from './retry';
export { type RunOptions, runSpec } from './run';
export {
  canonicalPreviousStage,
  classifyStage,
  flowVerdicts,
  readStage,
  type StageReading,
  type StageSource,
  stageSignatures,
} from './stages';
export { succession } from './succession';
export {
  compareTranscripts,
  type TranscriptBlock,
  type TranscriptComparison,
  transcriptOf,
} from './transcript';
