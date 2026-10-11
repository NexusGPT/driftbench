import {
  type AdapterCapabilities,
  type AgentAdapter,
  AgentFailure,
  type Observed,
  type ResolvedGiven,
  type Session,
  type Turn,
} from '@driftbench/core';
import type { ReplaySession } from './session';

export const CLAUDE_CODE_REPLAY_VERSION = '0.1.0';

export type ReplayAdapterOptions = {
  /** The mapped session. */
  session: ReplaySession;
  /** The session block the spec's first block reads. Default 0. */
  fromBlock?: number;
};

/**
 * The replay adapter: serves a recorded session to the runner, block by block, with no model call. The
 * spec's block k reads the session's block `fromBlock + k`. The stimulus the spec writes is not sent
 * anywhere: the recorded user message is what the agent answered. A spec longer than what is left of the
 * session fails the run with an AgentFailure that says so.
 */
export function replayAdapter(options: ReplayAdapterOptions): AgentAdapter {
  const from = options.fromBlock ?? 0;
  const { blocks } = options.session;
  if (!Number.isInteger(from) || from < 0) {
    throw new Error(`replayAdapter: fromBlock is a whole number of at least 0, got ${from}`);
  }
  const capabilities: AdapterCapabilities = {
    variants: false,
    seedPrefix: true,
    toolStubs: false,
    trace: false,
    sandbox: false,
    endState: false,
    deterministic: true,
  };
  return {
    id: 'claude-code',
    version: CLAUDE_CODE_REPLAY_VERSION,
    capabilities: () => capabilities,
    async open(given: ResolvedGiven): Promise<Session> {
      return {
        id: `replay-${given.hash.slice(0, 12)}`,
        adapter: 'claude-code',
        target: given.target,
        given,
        history: structuredClone(given.prefix),
      };
    },
    async send(_session: Session, turn: Turn): Promise<Observed> {
      const index = from + turn.index;
      const block = blocks[index];
      if (!block) {
        throw new AgentFailure(
          `the spec reads session block ${index}, but the session has ${blocks.length} block${blocks.length === 1 ? '' : 's'} (0 to ${blocks.length - 1})`,
        );
      }
      return structuredClone(block.observed);
    },
    async close() {},
  };
}
