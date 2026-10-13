import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  type AdapterCapabilities,
  type AgentAdapter,
  AgentFailure,
  type Observed,
  type ResolvedGiven,
  type Session,
  type Turn,
} from '@agent-nexus/driftbench-core';
import type { ReplaySession } from './session';

export const CLAUDE_CODE_REPLAY_VERSION = '0.1.1';

export type ReplayAdapterOptions = {
  /** The mapped session. */
  session: ReplaySession;
  /** The session block the spec's first block reads. Default 0. */
  fromBlock?: number;
  /**
   * The folder holding the files the session left (its after tree). With it, the adapter reads artifacts
   * from there for the artifact checks; without it, it offers no `readArtifact`.
   */
  files?: string;
};

/** The most bytes one artifact read returns, as the process adapter's bounded read. */
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;

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
    ...(options.files === undefined ? {} : { readArtifact: artifactReader(options.files) }),
  };
}

/** Reads a file under the folder, refusing a path that leaves it and a file over the bound. */
function artifactReader(folder: string): (session: Session, path: string) => Promise<Uint8Array> {
  const root = resolve(folder);
  return async (_session, path) => {
    const full = resolve(root, path);
    const inside = relative(root, full);
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
      throw new Error(`${path} is outside the session's files (${root})`);
    }
    const info = await stat(full);
    if (info.size > MAX_ARTIFACT_BYTES) {
      throw new Error(`${path} holds ${info.size} bytes, over the ${MAX_ARTIFACT_BYTES} byte bound`);
    }
    return new Uint8Array(await readFile(full));
  };
}
