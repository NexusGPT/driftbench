import { readFile } from 'node:fs/promises';
import { DeviationClass } from '@driftbench/core';
import { describe, expect, it } from 'vitest';
import { INVENTORY_PATH, loadAcmeSpecs } from './support/specs';
import { parseYaml } from './support/yaml';

/** The inventory contract shared with the coverage tool. */
type Behaviour = { id: string; title: string; kind?: 'conversation' | 'task'; channels?: string[] };
type Flow = { id: string; title: string; behaviours: string[]; deviations?: string[] };
type Inventory = { behaviours: Behaviour[]; flows: Flow[]; channels?: string[] };

const inventory = parseYaml(await readFile(INVENTORY_PATH, 'utf8')) as Inventory;
const specs = (await loadAcmeSpecs()).map((entry) => entry.spec);
const channels = inventory.channels ?? [];
const kindOf = (behaviour: Behaviour) => behaviour.kind ?? 'conversation';
const flowOf = (tags: string[] | undefined) => tags?.find((tag) => tag.startsWith('flow:'))?.slice(5);

describe('the inventory', () => {
  it('keeps the contract: top-level keys, id patterns, kinds and channels', () => {
    expect(Object.keys(inventory).sort()).toEqual(['behaviours', 'channels', 'flows']);
    for (const behaviour of inventory.behaviours) {
      expect(Object.keys(behaviour).every((key) => ['id', 'title', 'kind', 'channels'].includes(key))).toBe(
        true,
      );
      expect(behaviour.id).toMatch(/^[A-Z]+-\d+$/);
      expect(behaviour.title.length).toBeGreaterThan(0);
      expect(['conversation', 'task']).toContain(kindOf(behaviour));
      for (const channel of behaviour.channels ?? []) expect(channels).toContain(channel);
    }
    for (const flow of inventory.flows) {
      expect(
        Object.keys(flow).every((key) => ['id', 'title', 'behaviours', 'deviations'].includes(key)),
      ).toBe(true);
      expect(flow.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      for (const deviation of flow.deviations ?? []) expect(DeviationClass.options).toContain(deviation);
    }
  });

  it('has at least 10 behaviours (two of kind task), 4 flows, and required deviations on 2 flows', () => {
    const ids = inventory.behaviours.map((behaviour) => behaviour.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(inventory.behaviours.filter((behaviour) => kindOf(behaviour) === 'task')).toHaveLength(2);
    expect(inventory.flows.length).toBeGreaterThanOrEqual(4);
    expect(
      inventory.flows.filter((flow) => (flow.deviations?.length ?? 0) > 0).length,
    ).toBeGreaterThanOrEqual(2);
    for (const flow of inventory.flows) {
      for (const id of flow.behaviours) expect(ids).toContain(id);
    }
  });
});

describe('the specs against the inventory', () => {
  it('cover only known behaviours of their own kind, on a known channel, in a known flow', () => {
    const byId = new Map(inventory.behaviours.map((behaviour) => [behaviour.id, behaviour]));
    for (const spec of specs) {
      expect(channels, spec.id).toContain(spec.channel);
      expect(
        inventory.flows.map((flow) => flow.id),
        spec.id,
      ).toContain(flowOf(spec.tags));
      for (const id of spec.covers ?? []) {
        const behaviour = byId.get(id);
        expect(behaviour, `${spec.id} covers ${id}`).toBeDefined();
        if (behaviour) expect(kindOf(behaviour), `${spec.id} covers ${id}`).toBe(spec.kind);
      }
    }
  });

  it('leave both covered and missing cells in the behaviour by channel matrix', () => {
    const cells = inventory.behaviours.flatMap((behaviour) =>
      (behaviour.channels ?? channels).map((channel) => ({
        cell: `${behaviour.id}@${channel}`,
        covered: specs.some((spec) => spec.channel === channel && spec.covers?.includes(behaviour.id)),
      })),
    );
    const missing = cells.filter((cell) => !cell.covered).map((cell) => cell.cell);
    expect(missing).toContain('B-007@chat');
    expect(missing).toContain('B-006@chat');
    expect(cells.filter((cell) => cell.covered).map((cell) => cell.cell)).toEqual(
      expect.arrayContaining(['B-001@chat', 'B-006@whatsapp', 'B-008@whatsapp', 'B-013@chat', 'B-014@chat']),
    );
  });

  it('leave both covered and missing cells in the flow by deviation matrix', () => {
    const cells = inventory.flows.flatMap((flow) =>
      (flow.deviations ?? []).map((deviation) => ({
        cell: `${flow.id}/${deviation}`,
        covered: specs.some(
          (spec) =>
            flowOf(spec.tags) === flow.id &&
            (spec.perturbations ?? []).some((perturbation) => perturbation.class === deviation),
        ),
      })),
    );
    expect(cells.filter((cell) => cell.covered).map((cell) => cell.cell)).toEqual([
      'new-home/D1_off_topic',
      'new-home/D6_instruction_in_data',
      'new-home/D8_tool_failure',
      'new-home/D10_return',
      'order/D4_loose_confirmation',
      'order/D8_tool_failure',
      'price-sheet/D6_instruction_in_data',
    ]);
    expect(cells.filter((cell) => !cell.covered).map((cell) => cell.cell)).toEqual([
      'new-home/D5_language_switch',
      'order/D2_goal_shift',
      'order/D3_contradiction',
    ]);
  });
});
