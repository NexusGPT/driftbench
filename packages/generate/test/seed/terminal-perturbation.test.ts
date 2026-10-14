import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSpec, type Spec } from '@agent-nexus/driftbench-core';
import { createPerturbingDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { faultFamily } from '../../../validators/src/ladders/generator/faults';
import { createFollower } from '../../../validators/src/ladders/generator/follower';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { followerAdapter, generateFrom, runContext } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';
import { generateSuiteToDisk } from '../../src/enumerate/stream';

const hidden = hiddenSpec(1);
const source = await generateFrom(hidden, renderMap(hidden), 1, {}, { once: true });
if (!source.prepared) throw new Error('the fictional map failed to load');
const suite = generateSuite(source.prepared, { mapPath: '../map.yaml', t: 3, seed: 1 });

/** The stage the walk had reached where a perturbation is said. */
const reached = (spec: Spec, at: number) => (at > 0 ? spec.blocks[at - 1]?.expect?.stage : undefined);

const moving = suite.complete.flatMap((spec) =>
  (spec.perturbations ?? [])
    .filter((entry) => entry.class === 'D2_goal_shift')
    .filter((entry) => {
      const stage = reached(spec, entry.inject_at ?? 0);
      return stage !== undefined && entry.recovery?.stage_after !== stage;
    })
    .map((entry) => ({ spec, id: entry.id })),
);

describe('a class whose recovery moves the conversation', () => {
  it('is declared by a clean walk cut at its stage, said after the last turn', () => {
    // A goal shift said after intake goes back to intake: no later turn of the walk could follow it, so the
    // walk stops where it is said and the perturbation comes after its last turn, with no end state.
    expect(moving.length).toBeGreaterThan(0);
    for (const { spec, id } of moving) {
      const perturbation = spec.perturbations?.find((entry) => entry.id === id);
      expect(perturbation?.inject_at, spec.id).toBe(spec.blocks.length);
      expect(perturbation?.expect?.stage, spec.id).toBe(perturbation?.recovery?.stage_after);
      expect(spec.end_state, spec.id).toBeUndefined();
      expect(
        spec.blocks.some((block) => 'injection' in block.when),
        spec.id,
      ).toBe(false);
    }
    expect(suite.report.invalid).toEqual([]);
  }, 60_000);

  it('passes the rule follower in a perturbed run and fails an agent that ignores the goal shift', async () => {
    const context = runContext();
    const ignore = faultFamily(hidden).find(
      (fault) => fault.def.id.startsWith('D2.ignore') && fault.where === 'any' && fault.rate === 1,
    );
    if (ignore?.def.agent.kind !== 'function') throw new Error('no every-time D2.ignore fault');
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
    expect(moving.length).toBeGreaterThan(0);
    for (const { spec, id } of moving) {
      const reference = await run(spec, id, createFollower(hidden));
      expect(
        reference.blocks.every((block) => block.pass),
        `${spec.id}: the follower fails the perturbed run`,
      ).toBe(true);
      const faulty = await run(spec, id, ignore.def.agent.create);
      expect(
        faulty.blocks.some((block) => !block.pass),
        `${spec.id}: ignoring the goal shift passes`,
      ).toBe(true);
    }
  }, 120_000);

  it('is written by the disk API exactly as the eager API writes it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'driftbench-cut-'));
    try {
      const prepared = source.prepared;
      if (!prepared) throw new Error('the fictional map failed to load');
      await generateSuiteToDisk(prepared, { mapPath: '../map.yaml', t: 3, seed: 1, outputDir: directory });
      const cut = suite.files.filter((file) => /\/gen-deviation-cut-\d+\.yaml$/.test(file.path));
      expect(cut.length).toBeGreaterThan(0);
      for (const file of cut) expect(await readFile(join(directory, file.path), 'utf8')).toBe(file.text);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
