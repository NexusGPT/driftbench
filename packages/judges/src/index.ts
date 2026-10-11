/** Judge clients, the judge council, the prompt kit and cassettes. */
export const packageName = '@driftbench/judges';

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
  type Vote,
} from './council';
export { familyOfModel, normalizeFamily, sameFamily } from './family';
export { type FetchLike, type HttpOptions, JudgeError, type JudgeErrorCode, postJson } from './http';
export {
  ANSWER_CONTRACT,
  buildPrompt,
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
