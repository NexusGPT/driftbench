import { runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { combinedFault } from '../../../validators/src/ladders/generator/faults';
import { createFollower } from '../../../validators/src/ladders/generator/follower';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { followerAdapter, generateFrom, runContext } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';

const seed = 1;
const hidden = hiddenSpec(seed);
const source = await generateFrom(hidden, renderMap(hidden), seed, {}, { once: true });
if (!source.prepared) throw new Error('the fictional map failed to load');
const suite = generateSuite(source.prepared, { mapPath: '../map.yaml', t: 2, seed });
const restated = suite.complete.filter((spec) => spec.id.startsWith('gen-restated-'));

describe('a restated slot', () => {
  it('states a value that no single slip of the asked value reaches', () => {
    // On this map every restated enum has three members, so a value apart from the asked one exists.
    expect(restated.length).toBeGreaterThan(0);
    for (const spec of restated) {
      const at = spec.blocks.findIndex((block) => block.id?.endsWith('-restated'));
      const asked = spec.blocks[at]?.expect?.tools?.find((tool) => tool.count === 1);
      const move = spec.blocks[at + 1]?.expect?.tools?.find((tool) => tool.label === asked?.label);
      const field = Object.keys(move?.input ?? {}).find(
        (key) => JSON.stringify(asked?.input?.[key]) !== JSON.stringify(move?.input?.[key]),
      ) as string;
      const tool = hidden.tools.find((entry) => entry.name === asked?.label);
      const property = tool?.input.find((entry) => entry.name === field);
      expect(property?.type, spec.id).toBe('enum');
      const members = property?.type === 'enum' ? property.members : [];
      const first = String(asked?.input?.[field]);
      const latest = String(move?.input?.[field]);
      expect(latest, `${spec.id}: the next member of ${first}`).not.toBe(
        members[(members.indexOf(first) + 1) % members.length],
      );
      expect(latest, `${spec.id}: the first member`).not.toBe(members[0]);
    }
  }, 180_000);

  it('fails, at a block that catches keeping the first value, an agent that also sends the next enum member', async () => {
    // The pair item's question: a block that fails an agent keeping the first value must still fail it when
    // the same agent also sends the next enum member. With the next member stated as the latest value, the two
    // slips cancel at the move and only the request block fails, for the other reason.
    const context = runContext();
    const first = combinedFault(hidden, ['X2.slot-first']);
    const masked = combinedFault(hidden, ['X1.enum-next', 'X2.slot-first']);
    if (first.def.agent.kind !== 'function' || masked.def.agent.kind !== 'function')
      throw new Error('the validator plants function faults only');
    const run = (spec: (typeof restated)[number], create: Parameters<typeof followerAdapter>[0]) =>
      runSpec(spec, {
        adapter: followerAdapter(create),
        driver: createScriptedDriver(),
        checks: context.checks,
        mode: 'F',
        repeat: 1,
      });
    expect(restated.length).toBeGreaterThan(0);
    for (const spec of restated) {
      const reference = await run(spec, createFollower(hidden));
      expect(
        reference.blocks.every((block) => block.pass),
        `${spec.id}: the follower fails it`,
      ).toBe(true);
      const alone = await run(spec, first.def.agent.create);
      const catching = alone.blocks.flatMap((block, index) => (block.pass ? [] : [index]));
      expect(catching.length, `${spec.id}: keeping the first value passes`).toBeGreaterThan(0);
      const both = await run(spec, masked.def.agent.create);
      expect(
        catching.some((index) => both.blocks[index]?.pass === false),
        `${spec.id}: blocks ${catching.join(', ')} pass when the agent also sends the next member`,
      ).toBe(true);
    }
  }, 180_000);
});
