/**
 * The Claude Code adapter: reads a recorded session (transcript, guard decision log, step feed) into the
 * generic trace, serves it to the runner for replay, and adds the ordered-pair check the estate gates need.
 * The live runner (`./live`) runs the runtime headless in a sandbox and maps its stream the same way.
 */
export {
  type DecisionRow,
  decisionRow,
  type JsonlLine,
  parseJsonl,
  type StepRow,
  stepRow,
} from './format';
export * from './live';
export { type OrderedPair, orderedCheck } from './ordered';
export { CLAUDE_CODE_REPLAY_VERSION, type ReplayAdapterOptions, replayAdapter } from './replay';
export {
  type BlockMeta,
  diffTrees,
  type KeptRecord,
  type Marker,
  mapSession,
  NotATranscriptError,
  type ReplayBlock,
  type ReplayRaw,
  type ReplaySession,
  readSession,
  type SessionInput,
  type SessionMeta,
  type SessionPaths,
  type Tree,
  treeOf,
} from './session';
