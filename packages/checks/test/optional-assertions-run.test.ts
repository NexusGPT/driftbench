import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { type Observed, runSpec, type Spec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { defaultChecks } from '../src/defaults';

const block = {
  when: { user: 'Look up the green sample.' },
  expect: {
    stage: 'check',
    stage_reported: true,
    tools: [{ label: 'lookup', input: { kind: 'green' }, input_closed: true }],
  },
};
const spec: Spec = {
  id: 'optional-observation-assertions',
  kind: 'conversation',
  stages: ['check'],
  blocks: [block, block],
};

function reply(): Observed {
  return {
    segments: [{ type: 'text', text: 'Found the sample.' }],
    text: 'Found the sample.',
    toolCalls: [{ label: 'lookup', input: { kind: 'green' }, output: { found: true } }],
    runtime: { stages: [{ name: 'check' }] },
    cost: {},
    latencyMs: 0,
  };
}

describe('optional assertions through the shared runner', () => {
  it.each(['T', 'F', 'P'] as const)(
    'gates both mutations in mode %s and restores clean behavior',
    async (mode) => {
      const run = async (mutate?: (seen: Observed, index: number) => void, inputSpec = spec) => {
        let index = 0;
        return runSpec(inputSpec, {
          adapter: functionAdapter({
            respond: () => {
              const seen = reply();
              mutate?.(seen, index++);
              return seen;
            },
          }),
          driver: createScriptedDriver(),
          checks: defaultChecks(),
          mode,
          repeat: 0,
        });
      };
      expect((await run()).blocks.every((entry) => entry.pass)).toBe(true);
      const extra = await run((seen) => {
        const call = seen.toolCalls[0];
        if (!call) throw new Error('the fixture omitted lookup');
        call.input = { kind: 'green', note: 'unapproved' };
      });
      expect(extra.status).toBe('completed');
      expect(extra.blocks.every((entry) => !entry.pass)).toBe(true);
      expect(extra.blocks[0]?.verdicts).toContainEqual(
        expect.objectContaining({
          id: 'tools.lookup.input_closed',
          outcome: 'fail',
          gating: true,
        }),
      );
      const missing = await run((seen, index) => {
        if (index === 1) delete seen.runtime;
      });
      expect(missing.status).toBe('completed');
      expect(missing.blocks[0]?.pass).toBe(true);
      expect(missing.blocks[1]?.stageObserved).toBe('check');
      expect(missing.blocks[1]?.pass).toBe(false);
      expect(missing.blocks[1]?.verdicts).toContainEqual(
        expect.objectContaining({
          id: 'stage.reported',
          outcome: 'fail',
          gating: true,
        }),
      );
      const old: Spec = {
        ...spec,
        blocks: spec.blocks.map((entry) => ({
          ...entry,
          expect: { stage: 'check', tools: [{ label: 'lookup', input: { kind: 'green' } }] },
        })),
      };
      const compatible = await run((seen) => {
        delete seen.runtime;
        const call = seen.toolCalls[0];
        if (!call) throw new Error('the fixture omitted lookup');
        call.input = { kind: 'green', note: 'allowed by an open input' };
      }, old);
      expect(compatible.blocks.every((entry) => entry.pass)).toBe(true);
      expect((await run()).blocks.every((entry) => entry.pass)).toBe(true);
    },
  );
});
