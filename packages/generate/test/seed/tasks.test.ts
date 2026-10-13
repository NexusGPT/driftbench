import { dirname } from 'node:path';
import { readWorkbook } from '@agent-nexus/driftbench-artifacts';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadApprovedMap } from '../../src/enumerate/load';
import { TaskFamilyRelation } from '../../src/extract/proposal';
import type { PreparedMap } from '../../src/seed/map';
import { buildTaskInputs, taskSpecs } from '../../src/seed/tasks';
import { ACME_MAP } from '../enumerate/support';

/**
 * A task family can write the specs of several branches of one flow: each `task_family` relation names the
 * family knob values of the instances it places (`instances`) and the cell values they hold (`holds`). On
 * Acme, the price sheet built from the catalog, and the summary added to an existing workbook.
 */

const by = {
  evidence: { source: '../README.md', quote: 'its stage, `build_sheet` or `add_summary`' },
  produced_by: 'model' as const,
  approved: true,
};

function branch(stages: string[], start: string, extra: Record<string, unknown> = {}): TaskFamilyRelation {
  return TaskFamilyRelation.parse({
    kind: 'task_family',
    flow: 'price-sheet',
    family: '../families/price-sheet',
    stages,
    holds: { user_type: ['sales-operations'], workspace_start: [start] },
    instances: { start },
    ...by,
    ...extra,
  });
}

let prepared: PreparedMap;

beforeAll(async () => {
  const loaded = await loadApprovedMap(ACME_MAP);
  if (!loaded.ok) throw new Error(`${loaded.code}: ${loaded.message}`);
  prepared = loaded.prepared;
}, 180_000);

function withFamilies(relations: TaskFamilyRelation[]): PreparedMap {
  return { ...prepared, relations: { ...prepared.relations, taskFamilies: relations } };
}

describe('task family relations that split a family by its knobs', () => {
  it('reads an instances condition on the relation', () => {
    expect(branch(['add_summary'], 'existing-workbook').instances).toEqual({ start: 'existing-workbook' });
    expect(
      TaskFamilyRelation.safeParse({
        ...branch(['add_summary'], 'existing-workbook'),
        instances: { start: [] },
      }).success,
    ).toBe(false);
  });

  it('gives each relation n instances whose knobs meet its condition, and tags them with its holds', async () => {
    const catalog = branch(['build_sheet', 'add_summary'], 'catalog-only', {
      deviations: ['D6_instruction_in_data'],
    });
    const existing = branch(['add_summary'], 'existing-workbook');
    const map = withFamilies([catalog, existing]);
    const built = await buildTaskInputs(map, dirname(ACME_MAP), {
      n: 3,
      seed: 1,
      seedFrom: (id) => `gen/specs/task/.seed-${id}`,
    });
    expect(built.refused).toEqual([]);
    expect(built.inputs.map((input) => input.relation)).toEqual([catalog, existing]);
    const instancesOf = (index: number) =>
      new Set(
        built.inputs[index]?.variants.map(
          (variant) => (variant.spec.metadata as { family: { instance: string } }).family.instance,
        ),
      );
    expect(instancesOf(0).size).toBe(3);
    expect(instancesOf(1).size).toBe(3);
    for (const name of instancesOf(1)) expect(instancesOf(0).has(name)).toBe(false);

    const placed = taskSpecs(map, built.inputs, { seed: 1, mapPath: 'map.yaml' });
    const ids = placed.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of placed) {
      const knobs = (entry.spec.metadata as { family: { knobs: Record<string, string> } }).family.knobs;
      const tags = entry.spec.tags as string[];
      expect(tags).toContain(`task:${knobs.start}`);
      expect(tags).toContain('persona:sales-operations');
      if (knobs.start === 'catalog-only') {
        expect(entry.seed).toBeUndefined();
        continue;
      }
      // The existing workbook is binary: the spec starts from a folder beside it, and the seeder hands the files over.
      expect(entry.spec.workspace_seed).toEqual({ from: `gen/specs/task/.seed-${entry.id}` });
      const workbook = String(knobs.workbook);
      const bytes = entry.seed?.binary[workbook];
      expect(bytes, `${entry.id} seeds ${workbook}`).toBeDefined();
      expect((await readWorkbook(bytes as Uint8Array)).length).toBeGreaterThan(0);
      expect(Object.keys(entry.seed?.text ?? {})).toContain(
        'catalog.csv' in (entry.seed?.text ?? {}) ? 'catalog.csv' : 'catalog.json',
      );
      expect((entry.spec.blocks as Array<{ id: string }>).map((block) => block.id)).toEqual(['summary']);
    }
  }, 180_000);

  it('refuses a relation whose condition names a knob the family does not have, and one no instance meets', async () => {
    const built = await buildTaskInputs(
      withFamilies([
        branch(['add_summary'], 'existing-workbook', { instances: { colour: 'red' } }),
        branch(['add_summary'], 'existing-workbook', { instances: { start: 'nowhere' } }),
      ]),
      dirname(ACME_MAP),
      { n: 1, seed: 1, seedFrom: (id) => id },
    );
    expect(built.inputs).toEqual([]);
    expect(built.refused.map((entry) => entry.reason)).toEqual([
      expect.stringMatching(/instances names the knob colour, which the family does not have/),
      expect.stringMatching(/no instance of the first \d+ drawn has start nowhere/),
    ]);
  }, 180_000);

  it('refuses a binary seed when the caller gives no folder for it', async () => {
    const built = await buildTaskInputs(
      withFamilies([branch(['add_summary'], 'existing-workbook')]),
      dirname(ACME_MAP),
      { n: 1, seed: 1 },
    );
    expect(built.inputs).toEqual([]);
    expect(built.refused[0]?.reason).toMatch(/binary seed folder/);
  }, 180_000);
});
