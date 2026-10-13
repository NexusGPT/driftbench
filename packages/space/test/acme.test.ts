import { fileURLToPath } from 'node:url';
import { type Inventory, type LoadResult, loadInventory, loadSpecs } from '@agent-nexus/driftbench-core';
import { coverage, loadSpaceMap, type SpaceMap } from '@agent-nexus/driftbench-space';
import { beforeAll, describe, expect, it } from 'vitest';

const MAP = fileURLToPath(new URL('./fixtures/acme-space.yaml', import.meta.url));
const INVENTORY = fileURLToPath(new URL('../../../examples/acme/inventory.yaml', import.meta.url));
const SPECS = fileURLToPath(new URL('../../../examples/acme/specs', import.meta.url));

let map: SpaceMap;
let specs: LoadResult[];
let inventory: Inventory;

beforeAll(async () => {
  const loaded = await loadSpaceMap(MAP);
  const inv = await loadInventory(INVENTORY);
  if (!loaded.ok || !inv.ok) throw new Error('the Acme fixture or inventory is invalid');
  map = loaded.map;
  inventory = inv.inventory;
  specs = await loadSpecs([SPECS]);
});

/**
 * The Acme map on the Acme specs. Sizes are derived by hand: the dimensions hold 12, 14, 9, 2, 3 and 6
 * values (54432 cells). The constraints forbid three behaviours and two stages on whatsapp: 3 x 1944 +
 * 2 x 2268 cells, less the 972 counted twice (a forbidden behaviour at a forbidden stage), so 9396
 * forbidden and 45036 allowed. Pairs: 823 in all, the 5 constraint pairs forbidden. Triples: 7230 in all,
 * 148 holding a forbidden pair (3 x 30 + 2 x 32, less the 6 holding two).
 */
describe('the Acme map on the Acme specs', () => {
  it('counts the allowed cells, pairs and triples', () => {
    const full = coverage(map, specs, { inventory });
    expect(full.grid).toMatchObject({ total: 54432, allowed: 45036 });
    expect(full.tway.map((entry) => [entry.t, entry.total, entry.allowed])).toEqual([
      [2, 823, 818],
      [3, 7230, 7082],
    ]);
  });

  it('places every deviation on the stage it arrives at: 21 stage and deviation pairs', () => {
    const pairs = coverage(map, specs, { t: 2 })
      .grid.cells.filter((cell) => Object.keys(cell.values).join() === 'stage,deviation' && cell.count > 0)
      .map((cell) => `${cell.values.stage} ${cell.values.deviation}`);
    const happy = [
      'identify',
      'address',
      'port_number',
      'offer',
      'details',
      'recap',
      'order_placed',
      'callback',
      'handover',
      'closing',
      'build_sheet',
      'add_summary',
    ].map((stage) => `${stage} none`);
    expect(pairs.sort()).toEqual(
      [
        ...happy,
        'address D1_off_topic', // shop-hours, before block 1 (address)
        'offer D1_off_topic', // the two detours of off-topic-return
        'offer D5_language_switch', // spanish-line
        'offer D6_instruction_in_data', // free-fiber
        'offer D10_return', // where-were-we and options-again
        'recap D4_loose_confirmation', // loose-yes, second-loose-yes, loose-ok
        'recap D8_tool_failure', // order-service-down arrives at recap, though its block expects handover
        'callback D8_tool_failure', // sales-queue-down
        'build_sheet D6_instruction_in_data', // instruction-in-notes, before the first block
      ].sort(),
    );
  });

  it('marks the required cells: recap with a loose yes, and the flow deviations of the inventory', () => {
    const result = coverage(map, specs, { t: 2, inventory });
    expect(result.required[0]).toEqual({
      source: 'map',
      values: { stage: 'recap', deviation: 'D4_loose_confirmation' },
      covered: true,
      specs: ['acme-order-loose-confirmation', 'acme-plan-upgrade'],
    });
    expect(
      result.required
        .filter((cell) => !cell.covered)
        .map((cell) => cell.source === 'inventory' && `${cell.flow} ${cell.deviation}`),
    ).toEqual(['new-home D5_language_switch', 'order D2_goal_shift', 'order D3_contradiction']);
    expect(result.ok).toBe(false);
  });

  it('warns about the classes the map leaves out and the persona no spec declares', () => {
    const result = coverage(map, specs, { inventory });
    expect(
      result.warnings.filter((warning) => warning.code === 'UNKNOWN_VALUE').map((w) => [w.subject, w.specs]),
    ).toEqual([
      ['D7_silence_or_burst', ['acme-number-porting']],
      ['D9_out_of_scope', ['acme-plan-upgrade']],
    ]);
    const unplaced = result.warnings.filter((warning) => warning.code === 'UNPLACED_SPEC');
    expect(unplaced).toHaveLength(7);
    expect(unplaced[0]?.message).toBe(
      'falls in no allowed cell of the full grid: it places on no value of persona',
    );
    expect(result.warnings.some((warning) => warning.code === 'FORBIDDEN_CELL')).toBe(false);
  });

  it('mutation: dropping any one constraint grows the allowed cells by what only it forbids', () => {
    const allowed = map.constraints.map(
      (_, dropped) =>
        coverage({ ...map, constraints: map.constraints.filter((__, index) => index !== dropped) }, []).grid
          .allowed,
    );
    // A behaviour constraint alone forbids 1944 - 324 cells; a stage constraint 2268 - 486.
    expect(allowed).toEqual([46656, 46656, 46656, 46818, 46818]);
  });
});
