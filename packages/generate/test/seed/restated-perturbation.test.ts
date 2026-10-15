import { runSpec, type Spec } from '@agent-nexus/driftbench-core';
import { createPerturbingDriver } from '@agent-nexus/driftbench-users';
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
const suite = generateSuite(source.prepared, { mapPath: '../map.yaml', t: 3, seed });
const restated = suite.complete.filter((spec) => spec.id.startsWith('gen-restated-'));

/** The position of the block that asks for the first value. */
const requestAt = (spec: Spec) => spec.blocks.findIndex((block) => block.id?.endsWith('-restated'));

describe('a restated walk in perturbed mode', () => {
  it('declares a perturbation no later than its request', () => {
    expect(restated.length).toBeGreaterThan(0);
    for (const spec of restated) {
      expect(spec.perturbations?.length ?? 0, spec.id).toBeGreaterThan(0);
      for (const perturbation of spec.perturbations ?? [])
        expect(perturbation.inject_at, `${spec.id} ${perturbation.id}`).toBeLessThanOrEqual(requestAt(spec));
    }
  });

  it('passes the follower and fails an agent that keeps the first value, in every perturbed run', async () => {
    const context = runContext();
    const first = combinedFault(hidden, ['X2.slot-first']);
    if (first.def.agent.kind !== 'function') throw new Error('the validator plants function faults only');
    const run = (spec: Spec, id: string, create: Parameters<typeof followerAdapter>[0]) => {
      const driver = createPerturbingDriver({ spec, perturbation: id });
      return runSpec(driver.spec, {
        adapter: followerAdapter(create),
        driver,
        checks: context.checks,
        mode: 'P',
        repeat: 1,
        perturbationId: id,
      });
    };
    expect(restated.length).toBeGreaterThan(0);
    for (const spec of restated) {
      for (const { id } of spec.perturbations ?? []) {
        const reference = await run(spec, id, createFollower(hidden));
        expect(
          reference.blocks.every((block) => block.pass),
          `${spec.id} ${id}: the follower fails the perturbed run`,
        ).toBe(true);
        const faulty = await run(spec, id, first.def.agent.create);
        expect(
          faulty.blocks.some((block) => !block.pass),
          `${spec.id} ${id}: keeping the first value passes the perturbed run`,
        ).toBe(true);
      }
    }
  }, 180_000);
});
