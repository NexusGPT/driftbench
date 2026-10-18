import { fileURLToPath } from 'node:url';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { type AgentAdapter, type LoadedSpec, loadSpecs, validateSpec } from '@agent-nexus/driftbench-core';
import { mulberry32 } from '@agent-nexus/driftbench-stats';
import {
  createRandomAgent,
  type RandomAgentOptions,
} from '../../../../examples/acme/pilot/random-agent/index';
import { createAcmeAgent, createStore } from '../../../../examples/acme/src/index';
import { loadApprovedMap } from '../../src/enumerate';
import { pilotControlCheck } from '../../src/pilot/control';
import type { PilotMap } from '../../src/pilot/design';
import type { PilotObservation } from '../../src/pilot/run';

/** Fictional test data only. */

export const ACME_MAP = fileURLToPath(
  new URL('../../../../examples/acme/map/approved.yaml', import.meta.url),
);
export const ACME_SUITE = fileURLToPath(
  new URL('../../../../examples/acme/generated/specs', import.meta.url),
);

export async function acmePilotMap(): Promise<PilotMap> {
  const map = await loadApprovedMap(ACME_MAP);
  if (!map.ok) throw new Error(`the Acme map does not load: ${map.message}`);
  return {
    path: ACME_MAP,
    agent: map.prepared.agent,
    hash: map.prepared.hash,
    phrasesOf: map.prepared.phrasesOf,
    binds: map.prepared.relations.binds,
  };
}

export async function acmeSuite(): Promise<LoadedSpec[]> {
  const results = await loadSpecs([ACME_SUITE]);
  const loaded = results.filter((result): result is LoadedSpec => result.ok);
  if (loaded.length !== results.length) throw new Error('a generated Acme spec is invalid');
  return loaded;
}

export function acmeAdapter(): AgentAdapter {
  return functionAdapter<{
    store: ReturnType<typeof createStore>;
    agent: ReturnType<typeof createAcmeAgent>;
  }>({
    create: () => {
      const store = createStore();
      return { store, agent: createAcmeAgent(store) };
    },
    respond: (messages, world, _vars, session) => session.agent.respond(messages, world),
    payloads: (session) => session.store.payloads,
    deterministic: true,
  });
}

export function randomAdapter(options: RandomAgentOptions = {}): AgentAdapter {
  const agent = createRandomAgent(options);
  return functionAdapter<ReturnType<typeof agent.create>>({
    create: (given) => agent.create(given),
    respond: (messages, world, _vars, session) => agent.respond(messages, world, session),
    payloads: (session) => session.store.payloads,
    deterministic: false,
  });
}

export const pilotChecks = () => [...defaultChecks(), pilotControlCheck];

type BlockInput = {
  id: string;
  user?: string;
  injection?: { class: string; user: string };
  phrase?: { dimension: string; value: string };
};

/** A generated-looking conversation spec: its cell and phrased blocks under metadata.generated. */
export function generatedSpec(
  id: string,
  cell: Record<string, string>,
  blocks: BlockInput[],
  mapHash = 'map-1',
): LoadedSpec {
  const raw = {
    id,
    kind: 'conversation',
    channel: 'chat',
    blocks: blocks.map((block) => ({
      id: block.id,
      when: block.injection ? { injection: block.injection } : { user: block.user ?? 'hello' },
      expect: {},
    })),
    metadata: {
      generated: {
        by: 'driftbench generate',
        map: { hash: mapHash },
        cell,
        blocks: blocks.map((block) => ({
          block: block.id,
          ...(block.phrase ? { phrase: block.phrase } : {}),
        })),
      },
    },
  };
  const result = validateSpec(raw, `${id}.yaml`);
  if (!result.ok) throw new Error(`${id}: ${result.errors.map((issue) => issue.message).join('; ')}`);
  return result;
}

export function plainSpec(id: string): LoadedSpec {
  const result = validateSpec(
    { id, kind: 'conversation', blocks: [{ id: 'b1', when: { user: 'hi' }, expect: {} }] },
    `${id}.yaml`,
  );
  if (!result.ok) throw new Error(`${id}: ${result.errors.map((issue) => issue.message).join('; ')}`);
  return result;
}

export function bank(entries: Record<string, string[]>): PilotMap['phrasesOf'] {
  return new Map(Object.entries(entries).map(([key, texts]) => [key, texts.map((text) => ({ text }))]));
}

export type Simulation = {
  cells: number;
  conversations: number;
  wordings: number;
  repeats: number;
  /** Standard deviations of the additive effects on the pass chance, per level. */
  sd: { cell: number; conversation: number; wording: number };
  base: number;
  seed: number;
};

/**
 * Observations from a known model: pass chance p = clamp(base + cell + conversation + wording effects),
 * each effect uniform with the given standard deviation, one Bernoulli draw per repeat. Every observation
 * states its planted failure chance, as a control agent does.
 */
export function simulate(s: Simulation): PilotObservation[] {
  const rng = mulberry32(s.seed);
  const effect = (sd: number) => (rng() * 2 - 1) * sd * Math.sqrt(3);
  const rows: PilotObservation[] = [];
  for (let c = 0; c < s.cells; c += 1) {
    const a = effect(s.sd.cell);
    for (let k = 0; k < s.conversations; k += 1) {
      const b = effect(s.sd.conversation);
      for (let w = 0; w < s.wordings; w += 1) {
        const p = Math.min(0.98, Math.max(0.02, s.base + a + b + effect(s.sd.wording)));
        for (let r = 0; r < s.repeats; r += 1) {
          const pass = rng() < p;
          rows.push({
            cell: `cell-${c}`,
            conversation: `conv-${c}-${k}`,
            wording: w,
            map: 'map-1',
            suite: s.conversations,
            specId: `conv-${c}-${k}.w${w}`,
            repeat: r,
            status: 'completed',
            pass,
            blocks: [pass],
            planted: 1 - p,
          });
        }
      }
    }
  }
  return rows;
}

/** Rows of a deterministic agent: every repeat of a variant gives the same outcome. */
export function deterministicRows(outcomes: boolean[][][]): PilotObservation[] {
  const rows: PilotObservation[] = [];
  outcomes.forEach((conversations, c) => {
    conversations.forEach((wordings, k) => {
      wordings.forEach((pass, w) => {
        for (let r = 0; r < 5; r += 1) {
          rows.push({
            cell: `cell-${c}`,
            conversation: `conv-${c}-${k}`,
            wording: w,
            map: 'map-1',
            suite: conversations.length,
            specId: `conv-${c}-${k}.w${w}`,
            repeat: r,
            status: 'completed',
            pass,
            blocks: [pass],
          });
        }
      });
    });
  });
  return rows;
}
