/**
 * The validity gate (G4): a generated block enters a suite only through nine stages, in order: observed
 * state, leakage, shortcut, contrast, red first, stability, difficulty, label audit, freshness. Each stage
 * rejects or marks with a named reason; the funnel and the mutation score per fault class are reported.
 */
export {
  blockOutcome,
  CONSTANT_REPLY,
  failingIds,
  faultAdapter,
  firstTool,
  importFaultSet,
  patternWords,
  projectObserved,
  projectRun,
  type RunContext,
  runOnce,
  trivialAdapter,
} from './agents';
export {
  type BlockRecord,
  type ClassScore,
  classScores,
  type FaultRun,
  type FaultSummary,
  type FunnelRow,
  type GateInput,
  type GateResult,
  type KillCount,
  runGate,
  targets,
} from './gate';
export {
  blockText,
  containsToken,
  expectedValues,
  givenText,
  leakageStage,
  ngrams,
  originGrams,
  specText,
} from './leakage';
export {
  auditFamily,
  blockCell,
  deviationOf,
  generatorFamily,
  isWordingCell,
  machineSignature,
  mapHashOf,
  observedStage,
  stimulusText,
  thenFields,
} from './then';
export * from './types';
export {
  AUDIT_FILE,
  GATE_REPORT_FILE,
  GATED_DIR,
  type GateFile,
  type GateReportMeta,
  gateFiles,
  HOLDOUT_DIR,
  REVIEW_FILE,
  renderFunnel,
  SEAL_FILE,
} from './write';
