/** Judge clients, the judge council, the prompt kit and cassettes. */
export const packageName = '@driftbench/judges';

export { summarizeDiff, type TaskArtifactOptions, taskArtifactText } from './artifacts';
export {
  AssignmentTable,
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
  Cassette,
  CassetteEntry,
  CassetteJudge,
  cassettePlayers,
  emptyCassette,
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
  requestFor,
  verdictOf,
} from './check';
export type { ClientOptions, JudgeClient } from './client';
export { createAnthropicJudge, createGoogleJudge, createOpenAiJudge } from './clients/chat';
export { type FakeAnswer, FakeJudge } from './clients/fake';
export { createHttpJudge, type HttpJudgeOptions } from './clients/http-json';
export {
  binaryQuestion,
  createJevJudge,
  createOpenAiDecisionsJudge,
  type ProbabilityBounds,
  type System1Options,
} from './clients/system1';
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
  majority,
  type RoundOutcome,
  type UnassignedCriterion,
  type Vote,
} from './council';
export {
  type CriteriaIssue,
  type CriteriaLoad,
  CriterionFile,
  CriterionFixture,
  fixtureRequest,
  type LoadedCriterion,
  loadCriteria,
  parseCriterionFile,
} from './criteria';
export { familyOfModel, normalizeFamily, sameFamily } from './family';
export { type FetchLike, type HttpOptions, JudgeError, type JudgeErrorCode, postJson } from './http';
export { labelFilePath, readLabelFile, saveLabel } from './labels';
export {
  ANSWER_CONTRACT,
  buildPrompt,
  CRITERION_RULES,
  DATA_RULE,
  DATA_TAGS,
  type DataTag,
  dataTag,
  escapeData,
  RUBRIC_TEMPLATE,
  renderEntry,
  renderRubric,
  renderTranscript,
  renderUser,
  SYSTEM_PROMPT,
} from './prompt';
