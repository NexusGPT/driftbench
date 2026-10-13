/** Judge clients, the judge council, the prompt kit and cassettes. */
export const packageName = '@agent-nexus/driftbench-judges';

export { summarizeDiff, type TaskArtifactOptions, taskArtifactText } from './artifacts';
export { bradleyTerry } from './bradley-terry';
export { fitPrompt } from './budget';
export {
  AnnotationAnchor,
  AssignmentTable,
  agreementInterval,
  anchorNote,
  anchorProblem,
  assignmentTable,
  type CalibrationConfig,
  type CalibrationReport,
  type CouncilAssignment,
  type CriterionAssignment,
  type CriterionCalibration,
  calibrate,
  councilAssignment,
  DEFAULT_REPEATS,
  type JudgeCalibration,
  KAPPA_MIN,
  type LabelAgreement,
  LabelFile,
  type LabelIssue,
  LabelledBlock,
  type LabelsLoad,
  labelRequest,
  loadAssignmentTable,
  loadLabels,
  renderAssignmentTable,
  type Separation,
  writeAssignmentTable,
} from './calibration';
export {
  type CascadeConfig,
  type CascadeCriterion,
  type CascadeReport,
  type CascadeVariant,
  calibrateCascade,
} from './cascade';
export {
  Cassette,
  CassetteEntry,
  CassetteJudge,
  cassettePlayers,
  dataKey,
  emptyCassette,
  type KeyClient,
  loadCassette,
  playerClient,
  recordingClient,
  requestKey,
  saveCassette,
} from './cassette';
export {
  combineVerdicts,
  JUDGE_CHECK,
  type JudgeCheckOptions,
  judgeCheck,
  readInputs,
  requestFor,
  safeId,
  verdictOf,
} from './check';
export type { ClientOptions, JudgeClient } from './client';
export { createAnthropicJudge, createGoogleJudge, createOpenAiJudge } from './clients/chat';
export {
  CLAUDE_SETTINGS,
  type ClaudeCliOptions,
  claudeCost,
  createClaudeCliJudge,
} from './clients/claude-cli';
export { type FakeAnswer, FakeJudge } from './clients/fake';
export { createHttpJudge, type HttpJudgeOptions } from './clients/http-json';
export {
  binaryQuestion,
  createJevJudge,
  createOpenAiDecisionsJudge,
  type ProbabilityBounds,
  type System1Options,
} from './clients/system1';
export { type TokenUsage, type UsageProvider, usageFromResponse } from './clients/usage';
export { comparePair, type PairChoice, type PairJudge, type PairWinner } from './compare-pair';
export {
  type Budget,
  CriterionText,
  inconclusive,
  JudgeAnswer,
  JudgeClass,
  JudgeOutcome,
  type JudgeRequest,
  type JudgeResult,
  MAX_TOKENS,
  outcomeFromProbability,
  parseAnswerText,
  parseAnswerValue,
  repairAnswerText,
  TranscriptEntry,
} from './contract';
export {
  type AssignmentRow,
  type AssignmentSource,
  type Council,
  type CouncilConfig,
  CouncilConfigError,
  type CouncilMode,
  type CouncilResult,
  type CouncilRound,
  createCouncil,
  judgeRepeated,
  majority,
  type RepeatedJudging,
  type RoundOutcome,
  type UnassignedCriterion,
  type Vote,
} from './council';
export {
  type CriteriaIssue,
  type CriteriaLoad,
  CriterionFile,
  CriterionFixture,
  fixtureInputs,
  fixtureRequest,
  type LoadedCriterion,
  loadCriteria,
  parseCriterionFile,
} from './criteria';
export { type Grounding, groundEvidence } from './evidence';
export { familyOfModel, normalizeFamily, sameFamily } from './family';
export { findCycles } from './find-cycles';
export { type FetchLike, type HttpOptions, JudgeError, type JudgeErrorCode, postJson } from './http';
export { ATTACK_CRITERION, type AttackVerdict, judgeAttack } from './injection-judge';
export { labelFilePath, readLabelFile, saveLabel } from './labels';
export { type LintIssue, lintCriterion } from './lint';
export { buildPairPrompt } from './pair-prompt';
export {
  judgePairwise,
  type PairwiseChoice,
  type PairwiseTally,
  type PairwiseVerdict,
  pairwiseRequest,
  pairwiseTally,
  positionBias,
  readPairwiseCriterion,
  swapConsistent,
} from './pairwise';
export {
  ANSWER_CONTRACT,
  buildPrompt,
  DATA_RULE,
  DATA_TAGS,
  type DataTag,
  dataTag,
  escapeData,
  PROMPT_FINGERPRINT,
  PROMPT_PARTS,
  promptFingerprint,
  RUBRIC_TEMPLATE,
  renderEntry,
  renderRubric,
  renderTranscript,
  renderUser,
  SYSTEM_PROMPT,
  SYSTEM1_QUESTION,
} from './prompt';
export {
  type Agreement,
  addVote,
  agreementOf,
  assign,
  completeItem,
  emptyQueue,
  enqueue,
  QUEUE_FILE,
  type QueueEntry,
  type QueueState,
  type ReviewQueue,
  readQueue,
  writeQueue,
} from './queue';
export { type ScreenFinding, type ScreenReport, screenData } from './screen';
export { noJudgeCheck, type SingleJudgeOptions, singleJudgeCheck } from './single';
export { judgeTurns, type TurnOutcome, type TurnsResult } from './turns';
