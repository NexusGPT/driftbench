import { fileURLToPath } from 'node:url';
import { loadInventory, loadSpecs, validateInventory } from '@agent-nexus/driftbench-core';
import {
  formatSpaceMap,
  fromInventory,
  parseSpaceMapText,
  validateSpaceMap,
} from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';

const INVENTORY = fileURLToPath(new URL('../../../examples/acme/inventory.yaml', import.meta.url));
const SPECS = fileURLToPath(new URL('../../../examples/acme/specs', import.meta.url));

async function acme() {
  const inventory = await loadInventory(INVENTORY);
  if (!inventory.ok) throw new Error('the Acme inventory is invalid');
  return { inventory: inventory.inventory, specs: await loadSpecs([SPECS]) };
}

describe('fromInventory', () => {
  it('seeds stages, behaviours, deviations and channels from the Acme inventory and specs', async () => {
    const { inventory, specs } = await acme();
    const seeded = fromInventory(inventory, specs, { agent: 'acme-sales', inventory: '../inventory.yaml' });
    expect(
      seeded.dimensions.map((dimension) => [dimension.id, dimension.kind, dimension.values.map((v) => v.id)]),
    ).toEqual([
      [
        'stage',
        'stage',
        [
          'address',
          'offer',
          'details',
          'recap',
          'order_placed',
          'callback',
          'handover',
          'closing',
          'port_number',
          'identify',
          'build_sheet',
          'add_summary',
        ],
      ],
      ['behaviour', 'behaviour', inventory.behaviours.map((behaviour) => behaviour.id)],
      [
        'deviation',
        'deviation',
        [
          'none',
          'D1_off_topic',
          'D2_goal_shift',
          'D3_contradiction',
          'D4_loose_confirmation',
          'D5_language_switch',
          'D6_instruction_in_data',
          'D8_tool_failure',
          'D10_return',
        ],
      ],
      ['channel', 'channel', ['chat', 'whatsapp']],
    ]);
    expect(seeded.dimensions[1]?.values[0]).toEqual({
      id: 'B-001',
      title: 'Identify an existing customer by the email on the account before quoting their plan',
    });
    expect(seeded.constraints).toEqual(
      ['B-001', 'B-013', 'B-014'].map((id) => ({
        forbid: { behaviour: id, channel: 'whatsapp' },
        reason: `The inventory lists ${id} on chat only.`,
      })),
    );
    expect(seeded).toMatchObject({
      version: '1',
      agent: 'acme-sales',
      inventory: '../inventory.yaml',
      prior: { kind: 'declared' },
    });
    expect(validateSpaceMap(seeded).ok).toBe(true);
  });

  it('round-trips through the YAML an owner edits', async () => {
    const { inventory, specs } = await acme();
    const seeded = fromInventory(inventory, specs);
    const text = formatSpaceMap(seeded, ['Seeded for a test.']);
    expect(text.startsWith('# Seeded for a test.\n')).toBe(true);
    const parsed = parseSpaceMapText(text, 'yaml');
    expect(parsed.ok && parsed.map).toEqual(seeded);
  });

  it('leaves out what it cannot list, and keeps none in the deviation dimension', () => {
    const empty = validateInventory({ behaviours: [], flows: [] });
    if (!empty.ok) throw new Error('expected a valid inventory');
    const seeded = fromInventory(empty.inventory, []);
    expect(
      seeded.dimensions.map((dimension) => [dimension.id, dimension.values.map((value) => value.id)]),
    ).toEqual([
      ['deviation', ['none']],
      ['channel', ['default']],
    ]);
    expect(seeded.constraints).toEqual([]);
    expect(seeded.agent).toBe('agent');
    expect(validateSpaceMap(seeded).ok).toBe(true);
  });
});
