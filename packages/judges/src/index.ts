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
