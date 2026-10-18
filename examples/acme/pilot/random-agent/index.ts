import { createHash } from 'node:crypto';
import type { Message, Observed, ResolvedGiven, WorldState } from '@agent-nexus/driftbench-core';
import { PILOT_CONTROL_MARKER } from '@agent-nexus/driftbench-generate';
import { createAcmeAgent, createStore } from '../../src/index';

/**
 * The control agent of the variance pilot: the Acme sales assistant with failures planted at a known
 * rate per source, so the pilot can show it recovers them.
 *
 * Each block, before replying, it reads the conversation so far and decides whether the reply fails:
 *
 * - Wording-dependent: a variant of the conversation (its initial Given and every user message so far)
 *   is fragile with chance `fragile`. The draw is a hash of the seed, the Given hash and the user texts,
 *   so the same wording is fragile on every repeat and another wording of the same conversation draws
 *   again.
 * - Repeat-dependent: a fragile block fails with chance `pFragile`, a sturdy one with chance `pSturdy`,
 *   drawn fresh on every run (the k-th session of a Given gets the seed hash(seed, Given hash, k)).
 *
 * A failed block appends the planted-failure marker to its reply, which the pilot's gating control check
 * refuses.
 * Every block states its chance to fail and the model on its raw output (`pilotControl`), so the pilot
 * computes the planted variance per level for the exact design it ran.
 */
export type RandomAgentOptions = {
  seed?: number;
  /** Chance a variant is fragile. Default 0.5. */
  fragile?: number;
  /** Chance a fragile block fails on one run. Default 0.5. */
  pFragile?: number;
  /** Chance a sturdy block fails on one run. Default 0.05. */
  pSturdy?: number;
};

export const RANDOM_AGENT_DEFAULTS: Required<RandomAgentOptions> = {
  seed: 7,
  fragile: 0.5,
  pFragile: 0.5,
  pSturdy: 0.05,
};

export type RandomSession = {
  agent: ReturnType<typeof createAcmeAgent>;
  store: ReturnType<typeof createStore>;
  given: string;
  next: () => number;
};

export type RandomAgent = {
  readonly options: Required<RandomAgentOptions>;
  create(given: ResolvedGiven): RandomSession;
  respond(messages: Message[], world: WorldState, session: RandomSession): Promise<Observed>;
};

/** A uniform number in [0, 1) from a hash of the parts. */
export function uniform(...parts: readonly (string | number)[]): number {
  const digest = createHash('sha256').update(parts.join('\u0000')).digest();
  return digest.readUInt32BE(0) / 2 ** 32;
}

export function createRandomAgent(options: RandomAgentOptions = {}): RandomAgent {
  const o = { ...RANDOM_AGENT_DEFAULTS, ...options };
  for (const key of ['fragile', 'pFragile', 'pSturdy'] as const) {
    if (!(o[key] >= 0 && o[key] <= 1)) throw new RangeError(`createRandomAgent: ${key} must lie in [0, 1]`);
  }
  const opened = new Map<string, number>();
  return {
    options: o,
    create(given) {
      const k = opened.get(given.hash) ?? 0;
      opened.set(given.hash, k + 1);
      let draw = 0;
      const store = createStore();
      return {
        agent: createAcmeAgent(store),
        store,
        given: given.hash,
        next: () => {
          draw += 1;
          return uniform('run', o.seed, given.hash, k, draw);
        },
      };
    },
    async respond(messages, world, session) {
      const observed = await session.agent.respond(messages, world);
      const texts = messages.filter((message) => message.role === 'user').map((message) => message.content);
      const fragile = uniform('wording', o.seed, session.given, ...texts) < o.fragile;
      const pFail = fragile ? o.pFragile : o.pSturdy;
      const failed = session.next() < pFail;
      const text = failed ? `${observed.text} ${PILOT_CONTROL_MARKER}` : observed.text;
      const segments = observed.segments.map((segment, i) =>
        failed && segment.type === 'text' && i === observed.segments.length - 1
          ? { ...segment, text }
          : segment,
      );
      const raw = observed.raw !== null && typeof observed.raw === 'object' ? observed.raw : {};
      return {
        ...observed,
        segments,
        text,
        raw: { ...raw, pilotControl: { pFail, fragile, failed, model: { ...o } } },
      };
    },
  };
}
