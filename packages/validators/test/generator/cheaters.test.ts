import { blockOutcome, CONSTANT_REPLY, runOnce } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { baselineSpecs, baselineSuite } from '../../src/ladders/generator/baseline';
import { CHEATERS, cheaterAdapter, givenValues, replayCalls } from '../../src/ladders/generator/cheaters';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { runContext } from '../../src/ladders/generator/measure';

describe('the hand-written baseline', () => {
  it('holds one spec per flow and one limit spec, each loaded by the core loader', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const spec = hiddenSpec(seed);
      const suite = baselineSuite(spec);
      expect(suite.map((loaded) => loaded.spec.id)).toEqual([
        ...spec.flows.map((flow) => `hand-${flow.id}`),
        'hand-limits',
      ]);
      for (const { spec: hand, warnings } of suite) expect(warnings, hand.id).toEqual([]);
      const flows = suite.slice(0, spec.flows.length).map((loaded) => loaded.spec);
      for (const [index, hand] of flows.entries()) {
        expect(hand.covers).toEqual(spec.flows[index]?.behaviours);
        expect(hand.tags).toContain(`flow:${spec.flows[index]?.id}`);
        expect(hand.blocks.at(-1)?.expect?.stage).toBe(spec.final);
      }
    }
  });
});

describe('the cheaters', () => {
  const spec = hiddenSpec(1);
  const baseline = baselineSpecs(spec);
  const replay = replayCalls(baseline);
  const flow = baseline[0];
  if (!flow) throw new Error('no baseline spec');

  it('replays the distinct calls the hand-written suite expects, without the forbidden ones', () => {
    expect(replay.map((call) => call.tool).sort()).toEqual(
      spec.tools
        .filter((tool) => tool.stage !== undefined)
        .map((tool) => tool.name)
        .sort(),
    );
    for (const call of replay) expect(Object.keys(call.input)).toHaveLength(1);
  });

  it('reads every scalar of the Given world', () => {
    expect(
      givenValues({ tools: { a: { result: { found: true, rows: [1, 'two'] } } }, fixtures: { x: null } }),
    ).toEqual(['true', '1', 'two']);
  });

  it('runs each cheater through the real runner, each doing only what its name says', async () => {
    const world = {
      tools: { [spec.tools[0]?.name ?? '']: { result: { found: true, status: 'kept-value' } } },
    };
    const given = { ...flow, given: { world } };
    const seen: Record<string, ReturnType<typeof blockOutcome>[]> = {};
    for (const name of CHEATERS) {
      const run = await runOnce(given, cheaterAdapter(name, given, spec, replay), 1, runContext());
      seen[name] = given.blocks.map((_, index) => blockOutcome(run, index));
      const first = run.blocks[0]?.observed;
      expect(first?.runtime?.stages?.[0]?.name, name).toBe(given.stages?.[0]);
      const labels = first?.toolCalls.map((call) => call.label) ?? [];
      if (name === 'every-tool') {
        expect(labels).toEqual(spec.tools.map((tool) => tool.name));
        expect(first?.toolCalls.every((call) => JSON.stringify(call.input) === '{}')).toBe(true);
      } else if (name === 'replay-suite') {
        expect(labels).toEqual(replay.map((call) => call.tool));
      } else {
        expect(labels, name).toEqual([]);
      }
      if (name === 'copy-given') expect(first?.text).toContain('kept-value');
      if (name === 'constant') expect(first?.text).toBe(CONSTANT_REPLY);
    }
    // Every cheater stays at the first stage, so every block that expects a later stage fails on each of them.
    for (const name of CHEATERS)
      expect(
        seen[name]?.every((outcome) => outcome === 'fail'),
        name,
      ).toBe(true);
  });
});
