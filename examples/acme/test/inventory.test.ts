import { computeCoverage, type Inventory, loadInventory, loadSpecs } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { INVENTORY_PATH, SPECS_DIR } from './support/specs';

const loaded = await loadInventory(INVENTORY_PATH);
if (!loaded.ok) throw new Error(`invalid inventory: ${JSON.stringify(loaded.errors, null, 2)}`);
const inventory: Inventory = loaded.inventory;
const coverage = computeCoverage(await loadSpecs([SPECS_DIR]), inventory);

const cells = (status: 'covered' | 'missing') =>
  coverage.behaviours.flatMap((behaviour) =>
    behaviour.cells.filter((cell) => cell.status === status).map((cell) => `${behaviour.id}@${cell.channel}`),
  );
const deviations = (status: 'covered' | 'missing') =>
  coverage.flows.flatMap((flow) =>
    flow.cells.filter((cell) => cell.status === status).map((cell) => `${flow.id}/${cell.deviation}`),
  );

describe('the inventory', () => {
  it('loads with the inventory loader of the coverage command', () => {
    expect(loaded.ok).toBe(true);
    expect(inventory.channels).toEqual(['chat', 'whatsapp']);
  });

  it('has at least 10 behaviours (two of kind task), 4 flows, and required deviations on 2 flows', () => {
    expect(inventory.behaviours.length).toBeGreaterThanOrEqual(10);
    expect(inventory.behaviours.filter((behaviour) => behaviour.kind === 'task')).toHaveLength(2);
    expect(inventory.flows.length).toBeGreaterThanOrEqual(4);
    expect(
      inventory.flows.filter((flow) => (flow.deviations?.length ?? 0) > 0).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('coverage of the inventory by the Acme specs', () => {
  it('counts every spec, with no warning: known behaviours, flows and channels, kinds that match', () => {
    expect(coverage.invalidSpecs).toEqual([]);
    expect(coverage.warnings).toEqual([]);
    expect(coverage.channels).toEqual(['chat', 'whatsapp']);
  });

  it('shows covered and missing cells in the behaviour by channel matrix', () => {
    expect(cells('missing')).toEqual([
      'B-002@whatsapp',
      'B-003@whatsapp',
      'B-004@whatsapp',
      'B-005@whatsapp',
      'B-006@chat',
      'B-007@chat',
      'B-007@whatsapp',
      'B-009@whatsapp',
      'B-010@whatsapp',
      'B-011@whatsapp',
      'B-012@whatsapp',
    ]);
    expect(cells('covered')).toEqual(
      expect.arrayContaining(['B-001@chat', 'B-006@whatsapp', 'B-008@whatsapp', 'B-013@chat', 'B-014@chat']),
    );
    expect(coverage.perChannel).toEqual([
      { channel: 'chat', applicable: 14, covered: 12, missing: 2 },
      { channel: 'whatsapp', applicable: 11, covered: 2, missing: 9 },
    ]);
  });

  it('shows covered and missing cells in the flow by deviation matrix, the task flow included', () => {
    expect(deviations('covered')).toEqual([
      'new-home/D1_off_topic',
      'new-home/D6_instruction_in_data',
      'new-home/D8_tool_failure',
      'new-home/D10_return',
      'order/D4_loose_confirmation',
      'order/D8_tool_failure',
      'price-sheet/D6_instruction_in_data',
    ]);
    expect(deviations('missing')).toEqual([
      'new-home/D5_language_switch',
      'order/D2_goal_shift',
      'order/D3_contradiction',
    ]);
  });

  it('counts injection blocks and perturbations as deviation sources', () => {
    const newHome = coverage.flows.find((flow) => flow.id === 'new-home');
    const comeBack = newHome?.cells.find((cell) => cell.deviation === 'D10_return');
    expect(comeBack?.sources).toEqual([
      { spec: 'acme-off-topic-return', source: 'injection', path: 'blocks.3' },
      { spec: 'acme-off-topic-return', source: 'perturbation', path: 'perturbations.0' },
    ]);
  });

  it('fails on purpose while the gaps stay open: 4 of 14 behaviours, 7 of 10 deviations', () => {
    expect(coverage.summary).toEqual({
      behaviours: { covered: 4, total: 14 },
      deviations: { covered: 7, total: 10 },
    });
    expect(coverage.ok).toBe(false);
  });
});
