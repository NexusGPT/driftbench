import { fileURLToPath } from 'node:url';
import { functionAdapter } from '@driftbench/adapters';
import { defaultReaders } from '@driftbench/artifacts';
import { defaultChecks } from '@driftbench/checks';
import { type AgentAdapter, loadSpecs, type Spec } from '@driftbench/core';
import { localProvider } from '@driftbench/sandbox';
import { createScriptedDriver } from '@driftbench/users';
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

let specs: Spec[];
beforeAll(async () => {
  const loaded = await loadSpecs([fileURLToPath(new URL('generated/specs', ROOT))]);
  specs = loaded.flatMap((result) => (result.ok ? [result.spec] : []));
});

describe('the generated Acme suite on the real agent', () => {
  it('passes every block of every complete spec on the reference agent', async () => {
    expect(specs.length).toBe(225);
    const failing: string[] = [];
    for (const spec of specs) {
      const run = await runOnce(spec, sales(), 1, ctx);
      spec.blocks.forEach((block, index) => {
        const outcome = blockOutcome(run, index);
        if (outcome !== 'pass') failing.push(`${spec.id}#${block.id ?? index}: ${outcome}`);
      });
    }
    expect(failing).toEqual([]);
  }, 120_000);

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
    expect(killed.sort()).toEqual([
      'D2_goal_shift',
      'D4_loose_confirmation',
      'D6_instruction_in_data',
      'D8_tool_failure',
      'D9_out_of_scope',
    ]);
  }, 120_000);
});
