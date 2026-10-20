import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { types } from 'node:util';
import {
  type AdapterCapabilities,
  type AgentAdapter,
  AgentFailure,
  copyHistory,
  type Observed,
  type ResolvedGiven,
  type Session,
  type Stimulus,
  type Turn,
} from '@agent-nexus/driftbench-core';
import type { ReplaySession } from './session';

export const CLAUDE_CODE_REPLAY_VERSION = '0.1.2';

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
 * anywhere: it must match the recorded user message, after trimming outer whitespace. A different
 * stimulus or a spec longer than the remaining session fails the run with an AgentFailure.
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
        history: copyHistory(given.prefix),
      };
    },
    async send(_session: Session, turn: Turn): Promise<Observed> {
      copyHistory(_session.history);
      const index = from + turn.index;
      const block = blocks[index];
      if (!block) {
        throw new AgentFailure(
          `the spec reads session block ${index}, but the session has ${blocks.length} block${blocks.length === 1 ? '' : 's'} (0 to ${blocks.length - 1})`,
        );
      }
      if (messages(turn.stimulus) !== messages(block.stimulus)) {
        throw new AgentFailure(
          `stimulus mismatch at session block ${index}: requested ${JSON.stringify(turn.stimulus)}; recorded ${JSON.stringify(block.stimulus)}`,
        );
      }
      return copyRecorded(block.observed);
    },
    async close() {},
    ...(options.files === undefined ? {} : { readArtifact: artifactReader(options.files) }),
  };
}

const NOT_PLAIN = Symbol('not plain data');

/**
 * A copy of a recorded value, the copy structuredClone makes, made faster for plain data: plain objects and arrays
 * (their own enumerable keys in order, holes, shared and cyclic references kept), and primitives. A class
 * instance, a Map, a Date, a Proxy, a function or a symbol anywhere in the value makes the whole copy
 * structuredClone's own, so it copies or refuses the value as structuredClone does (a getter met on the way is
 * then read a second time).
 */
function copyRecorded<T>(value: T): T {
  const copies = new Map<object, unknown>();
  const copy = (item: unknown): unknown => {
    if (item === null || typeof item !== 'object') {
      if (typeof item === 'function' || typeof item === 'symbol') throw NOT_PLAIN;
      return item;
    }
    const known = copies.get(item);
    if (known !== undefined) return known;
    if (types.isProxy(item)) throw NOT_PLAIN;
    const prototype = Object.getPrototypeOf(item);
    let out: Record<string, unknown>;
    if (Array.isArray(item)) {
      if (prototype !== Array.prototype) throw NOT_PLAIN;
      out = new Array(item.length) as unknown as Record<string, unknown>;
    } else if (prototype === Object.prototype || prototype === null) out = {};
    else throw NOT_PLAIN;
    copies.set(item, out);
    for (const key of Object.keys(item)) {
      const child = copy((item as Record<string, unknown>)[key]);
      // An own `__proto__` key stays a key: an assignment would set the prototype instead.
      if (key === '__proto__')
        Object.defineProperty(out, key, {
          value: child,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      else out[key] = child;
    }
    return out;
  };
  try {
    return copy(value) as T;
  } catch (cause) {
    if (cause === NOT_PLAIN) return structuredClone(value);
    throw cause;
  }
}

/** Compare delivered messages, preserving burst boundaries and ignoring only outer whitespace. */
function messages(stimulus: Stimulus): string {
  const texts =
    'user' in stimulus ? [stimulus.user] : 'burst' in stimulus ? stimulus.burst : [stimulus.injection.user];
  return JSON.stringify(texts.map((text) => text.trim()));
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
