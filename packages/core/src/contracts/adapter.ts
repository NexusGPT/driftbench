import type { Message, TargetRef } from '../schema/common';
import type { Observed, ResolvedGiven } from '../schema/run';
import type { Stimulus } from '../schema/spec';

/**
 * The adapter contract. An adapter reaches one kind of agent (an in-process function, an HTTP
 * endpoint, a platform, a command line agent in a sandbox) and turns one block's stimulus into an
 * Observed. The core never imports an adapter; the runner receives one.
 *
 * Every adapter passes the same contract suite (packages/adapters/test/contract.ts) against the Acme
 * example before it ships.
 */

/** What an adapter can do. The runner reads it to pick what to attempt and what to report as n/a. */
export type AdapterCapabilities = {
  /** The target can name a prompt or model variant. */
  variants: boolean;
  /** A block can start from a prefix of earlier messages instead of replaying them. */
  seedPrefix: boolean;
  /** Tool results and errors in `given.world.tools` are honoured. */
  toolStubs: boolean;
  /** `trace` returns a richer read of the turn than `send`. */
  trace: boolean;
  /** The agent runs in a sandbox the adapter owns (code agents). */
  sandbox: boolean;
  /** `endState` can read a recorded payload or a store. */
  endState: boolean;
  /** The same input gives the same output; the determinism smoke test treats a difference as a fail. */
  deterministic: boolean;
};

/**
 * One open conversation or task with an agent, created from a resolved Given.
 *
 * The runner owns `history`: it appends the stimulus's user message(s) before `send` and the
 * assistant reply (text plus tool calls with their output or error) after it. At send time the
 * history ends with the current user turn. An adapter never appends to it.
 */
export type Session = {
  readonly id: string;
  readonly adapter: string;
  readonly target: TargetRef;
  readonly given: ResolvedGiven;
  /** The messages so far, the prefix included; the runner appends each stimulus and reply. */
  history: Message[];
  /** Adapter-private state (a conversation id, a sandbox, a process). Never read by the core. */
  state?: unknown;
};

/** The input of one block. */
export type Turn = {
  readonly index: number;
  readonly stimulus: Stimulus;
  /** The Given this block starts from. In teacher-forced mode it differs from the session's. */
  readonly given: ResolvedGiven;
  /** The block's budget, when the spec sets one; an adapter may stop the agent at the limit. */
  readonly budget?: { steps?: number; costUsd?: number; latencyMs?: number };
};

export interface AgentAdapter {
  /** The adapter id, as `target.adapter` names it: function, http, process, nexus. */
  readonly id: string;
  /** The adapter version, part of the cache key. */
  readonly version: string;
  capabilities(): AdapterCapabilities;
  /** Opens a session from a resolved Given. The prefix is seeded when `seedPrefix` is true, replayed otherwise. */
  open(given: ResolvedGiven): Promise<Session>;
  /** Runs one block and returns everything the agent did, every segment and tool call in order. */
  send(session: Session, turn: Turn): Promise<Observed>;
  /** A richer read of the last turn, when the runtime keeps one (a tracing store). Replaces the view `send` returned. */
  trace?(session: Session, turn: Turn): Promise<Observed>;
  /**
   * Reads an end-state source named by `end_state.source`, such as `tool:<label>` for the last payload
   * a tool received. The source `*` means every recorded payload, as a list, in order; the runner asks
   * for it when the spec says `end_state: none`, and the check passes only when the list is empty.
   */
  endState?(session: Session, source: string): Promise<unknown>;
  /** Reads a file the agent left in its workspace, bounded; the runner hands it to the artifact checks. */
  readArtifact?(session: Session, path: string): Promise<Uint8Array>;
  /** Releases what the session holds. Always called, also after a failure. */
  close(session: Session): Promise<void>;
}

/** Thrown by an adapter when the transport failed and the runner may retry. */
export class AdapterTransportError extends Error {
  readonly retryable = true;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AdapterTransportError';
  }
}

/** Thrown by an adapter when the agent itself failed; the runner records a failed cell and never retries. */
export class AgentFailure extends Error {
  readonly retryable = false;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AgentFailure';
  }
}
