import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { type LoadedSpec, loadSpecs, type Spec } from '@agent-nexus/driftbench-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateSuite } from '../../src/enumerate/generate';
import { loadApprovedMap } from '../../src/enumerate/load';
import type { PreparedMap } from '../../src/seed/map';
import { buildTaskInputs } from '../../src/seed/tasks';
import categorical from './fixtures/budget-categorical.json';
import { ACME, ACME_MAP } from './support';

/** The budget mode on the approved Acme map: the report field, the determinism, the pair rule. */
describe('budget mode on the approved Acme map', () => {
  let prepared: PreparedMap;
  let taskInputs: Awaited<ReturnType<typeof buildTaskInputs>>['inputs'];
  let handWritten: Spec[];

  beforeAll(async () => {
    const loaded = await loadApprovedMap(ACME_MAP);
    if (!loaded.ok) throw new Error(`${loaded.code}: ${loaded.message}`);
    prepared = loaded.prepared;
    const built = await buildTaskInputs(prepared, dirname(ACME_MAP), {
      n: 8,
      seed: 1,
      // As `driftbench generate` names it: the folder beside the spec, relative to the spec file.
      seedFrom: (id) => `./.seed-${id}`,
    });
    taskInputs = built.inputs;
    const hand = await loadSpecs([`${ACME}specs`]);
    handWritten = hand.filter((entry): entry is LoadedSpec => entry.ok).map((entry) => entry.spec);
  }, 180_000);

  const run = (budget: number, seed = 1) =>
    generateSuite(prepared, {
      t: 2,
      seed,
      budget,
      mapPath: '../map/approved.yaml',
      tasks: taskInputs,
      baseline: { label: 'examples/acme/specs', specs: handWritten },
    });

  it('reports the budget, the pick and the pair coverage under budget, and no other field changes', () => {
    const result = run(50);
    const budget = result.report.budget;
    expect(budget).toBeDefined();
    expect(budget?.budget).toBe(50);
    expect(budget?.picked).toBe(50);
    expect(budget?.pairs.covered).toBeLessThanOrEqual(budget?.pairs.allowed ?? 0);
    expect(result.report.options.budget).toBe(50);
    // Only the twise rows are replaced: the twise folder holds the budget's rows, all of them.
    const twiseRows = result.files.filter((file) => file.path.includes('/twise/'));
    expect(twiseRows.length).toBeGreaterThan(0);
  }, 120_000);

  it('does not cut below the pair-cover size: it exits clean and reports the pairs covered', () => {
    // Five picks cover at most 50 of the 314 allowed pairs of the five twise dimensions.
    const result = run(5);
    expect(result.report.budget?.pairs.covered).toBeLessThan(result.report.budget?.pairs.allowed ?? 0);
    expect(result.report.seeders.twise.cut).toBe(false);
  }, 120_000);

  it('gives the same files for the same seed', () => {
    const first = run(30, 5);
    const again = run(30, 5);
    expect(again.files).toEqual(first.files);
    expect(again.report.budget).toEqual(first.report.budget);
  }, 120_000);

  it('writes no budget field when the flag is not given', () => {
    const plain = generateSuite(prepared, {
      t: 2,
      mapPath: '../map/approved.yaml',
      tasks: taskInputs,
    });
    expect(plain.report.budget).toBeUndefined();
    expect(plain.report.options).not.toHaveProperty('budget');
  }, 120_000);

  it('pins the categorical Acme output with optional input, stage and reply assertions', () => {
    expect(prepared.hash).toBe(categorical.mapHash);
    for (const budget of [undefined, 20, 50, 100, 200]) {
      const result = generateSuite(prepared, {
        t: 2,
        seed: 1,
        ...(budget === undefined ? {} : { budget }),
        mapPath: '../map/approved.yaml',
        tasks: taskInputs,
        baseline: { label: 'examples/acme/specs', specs: handWritten },
      });
      const key = budget === undefined ? 'pairwise' : `budget-${budget}`;
      const expected = (categorical.hashes as Record<string, string>)[key];
      expect(createHash('sha256').update(JSON.stringify(result.files)).digest('hex')).toBe(expected);
      expect(result.report.budget?.numeric).toBeUndefined();
    }
  }, 120_000);
});
