import { fileURLToPath } from 'node:url';
import { functionAdapter, processAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type AgentAdapter,
  loadSpecs,
  type Spec,
  specParentRecord,
  stemOf,
} from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { beforeAll, describe, expect, it } from 'vitest';
import { faults } from '../../../../examples/acme/faults/index';
import { createAcmeAgent, createStore } from '../../../../examples/acme/src/index';
import { blockOutcome, faultAdapter, runOnce } from '../../src/gate';

/**
 * The complete generated Acme suite against the real agent: every block of every spec the paths built is
 * green on the reference, and each deviation probe goes red on the fault that mishandles its class. The
 * Thens came from the map alone; this is where they meet the agent.
 */

const ROOT = new URL('../../../../examples/acme/', import.meta.url);
const ctx = { checks: defaultChecks(), artifacts: defaultReaders(), driver: createScriptedDriver };

function sales(): AgentAdapter {
  return functionAdapter({
    create: () => {
      const store = createStore();
      return { store, agent: createAcmeAgent(store) };
    },
    respond: (messages, world, _vars, session) => session.agent.respond(messages, world),
    payloads: (session) => session.store.payloads,
    deterministic: true,
  });
}

/** The reference agent with one mutation: every text segment of its reply is sent twice. */
function doubled(): AgentAdapter {
  return functionAdapter({
    create: () => {
      const store = createStore();
      return { store, agent: createAcmeAgent(store) };
    },
    respond: async (messages, world, _vars, session) => {
      const observed = await session.agent.respond(messages, world);
      return {
        ...observed,
        segments: observed.segments.flatMap((segment): (typeof segment)[] =>
          segment.type === 'text' ? [segment, segment] : [segment],
        ),
      };
    },
    payloads: (session) => session.store.payloads,
    deterministic: true,
  });
}

function ops(): AgentAdapter {
  return processAdapter({
    command: process.execPath,
    args: [fileURLToPath(new URL('ops/agent.mjs', ROOT))],
    provider: localProvider(),
    deterministic: true,
  });
}

/** Every spec of the folder: the 437 generated conversations, each written back out whole, and their stems. */
let all: Spec[];
let specs: Spec[];
let stems: Spec[];
beforeAll(async () => {
  const loaded = await loadSpecs([fileURLToPath(new URL('generated/specs', ROOT))]);
  expect(loaded.filter((result) => !result.ok)).toEqual([]);
  all = loaded.flatMap((result) => (result.ok ? [result.spec] : []));
  specs = all.filter((spec) => stemOf(spec) === undefined);
  stems = all.filter((spec) => stemOf(spec) !== undefined);
});

/** The blocks a run of the spec scores: its own, after the opening it replays from a stem. */
const ownBlocks = (spec: Spec) =>
  spec.blocks.map((block, index) => ({ block, index })).slice(specParentRecord(spec)?.replayed ?? 0);

describe('the generated Acme suite on the real agent', () => {
  it('passes every block of every complete spec on the reference agent', async () => {
    expect(specs.length).toBe(435);
    expect(stems.length).toBeGreaterThan(0);
    const failing: string[] = [];
    // Every block is scored once: a shared opening in its stem's own run, every other block in its spec's.
    for (const spec of all) {
      // A price-sheet task runs on the ops agent its family names, as the gate routes it.
      const run = await runOnce(spec, spec.kind === 'task' ? ops() : sales(), 1, ctx);
      for (const { block, index } of ownBlocks(spec)) {
        const outcome = blockOutcome(run, index);
        if (outcome !== 'pass') failing.push(`${spec.id}#${block.id ?? index}: ${outcome}`);
      }
    }
    expect(failing).toEqual([]);
  }, 900_000);

  it('turns every conversation spec red on the agent that sends its reply twice', async () => {
    const survivors: string[] = [];
    const red = new Set<string>();
    for (const stem of stems.filter((entry) => entry.kind === 'conversation')) {
      const run = await runOnce(stem, doubled(), 1, ctx);
      for (const { block, index } of ownBlocks(stem))
        if (blockOutcome(run, index) === 'fail') red.add(`${stem.id}#${block.id}`);
    }
    for (const spec of specs.filter((entry) => entry.kind === 'conversation')) {
      const run = await runOnce(spec, doubled(), 1, ctx);
      const failed = ownBlocks(spec).some(({ index }) => blockOutcome(run, index) === 'fail');
      // A spec whose opening is red is blocked by it, never failed: the stem's own run holds that failure.
      const root = run.blocks.find((entry) => entry.blocked)?.blocked?.root;
      if (!failed && !(root !== undefined && red.has(root))) survivors.push(spec.id);
    }
    expect(survivors).toEqual([]);
  }, 900_000);

  it('turns each deviation probe red on the fault that mishandles its class', async () => {
    const planted = new Map(
      faults.filter((fault) => fault.kind === 'deviation').map((fault) => [fault.class, fault]),
    );
    const killed: string[] = [];
    for (const spec of specs.filter((entry) => entry.id.startsWith('gen-deviation-'))) {
      const index = spec.blocks.findIndex((block) => 'injection' in block.when);
      const block = spec.blocks[index];
      if (!block || !('injection' in block.when)) continue;
      const fault = planted.get(block.when.injection.class);
      if (!fault) continue;
      const run = await runOnce(
        spec,
        faultAdapter(fault, () => localProvider()),
        1,
        ctx,
      );
      const outcomes = spec.blocks.map((_entry, position) => blockOutcome(run, position));
      // The probe block, or a block after it that reads what the probe changed, goes red.
      if (outcomes.slice(index).includes('fail')) killed.push(block.when.injection.class);
    }
    expect([...new Set(killed)].sort()).toEqual([
      'D2_goal_shift',
      'D4_loose_confirmation',
      'D6_instruction_in_data',
      'D8_tool_failure',
      'D9_out_of_scope',
    ]);
  }, 120_000);
});
