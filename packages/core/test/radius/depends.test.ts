import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blockDependencies, loadSpecFile, type Spec, thenFields } from '../../src/index';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

async function spec(path: string): Promise<Spec> {
  const loaded = await loadSpecFile(`${ROOT}/${path}`);
  if (!loaded.ok) throw new Error(`${path} does not load`);
  return loaded.spec;
}

describe('blockDependencies', () => {
  it('reads a hand-written block from its Then, and marks its other dependencies unknown', async () => {
    const upgrade = await spec('examples/acme/specs/conversations/plan-upgrade.yaml');
    const deps = blockDependencies(upgrade, 1);
    expect(deps.tools).toEqual([{ label: 'catalog.search', count: 'some', input: true }]);
    expect(deps.stages).toEqual(['offer']);
    expect(deps.fields).toContain('text');
    expect(deps.criteria).toEqual(['no_invented_data', 'one_question_per_turn']);
    expect(deps.cell).toEqual({});
    expect(deps.cellKnown).toBe(false);
    expect(deps.atomsKnown).toBe(false);
    expect(deps.unknown).toBe(true);
    // The value the user states is a literal the block holds: a fixture change can find it.
    expect(deps.literals).toContain('sam.rivera@example.com');
  });

  it('reads a generated block from its Then and from the cell the generator recorded', async () => {
    const graph = await spec('examples/acme/generated/specs/graph/gen-graph-001.yaml');
    const index = graph.blocks.findIndex((block) => block.id === 'b2-identify-to-offer');
    const deps = blockDependencies(graph, index);
    expect(deps.tools).toEqual([
      { label: 'catalog.search', count: 'some', input: true },
      { label: 'order.create', count: 'zero', input: false },
    ]);
    // The walk declares a nudge as a perturbation, so it holds the one-message rule: the format field.
    expect(deps.fields).toEqual(['tools', 'stage', 'text', 'lang', 'format']);
    expect(deps.stages.sort()).toEqual(['identify', 'offer']);
    expect(deps.cell.stage_transition).toBe('identify-to-offer');
    expect(deps.cell.flow).toBe('upgrade');
    expect(deps.phrase).toEqual({ dimension: 'stage_transition', value: 'identify-to-offer' });
    expect(deps.path).toBe('upgrade-order');
    expect(deps.flow).toBe('upgrade');
    expect(deps.toolsForbidden).toEqual(['coverage.check', 'port.check', 'notify_sales']);
    expect(deps.toolsEndState).toEqual([]);
    expect(deps.unknown).toBe(false);
  });

  it('reads the end state on the last block only, and the deviation class of a probe', async () => {
    const graph = await spec('examples/acme/generated/specs/graph/gen-graph-001.yaml');
    expect(blockDependencies(graph, graph.blocks.length - 1).toolsEndState).toEqual(['order.create']);
    const probe = await spec('examples/acme/generated/specs/deviation/gen-deviation-010.yaml');
    const failure = probe.blocks.findIndex((block) => block.id === 'b2-D8_tool_failure');
    const deps = blockDependencies(probe, failure);
    expect(deps.deviation).toBe('D8_tool_failure');
    expect(deps.toolsForced).toEqual(['catalog.search']);
    // The Given of an earlier block does not hold the forced failure: it starts at the probe.
    expect(blockDependencies(probe, 0).toolsForced).toEqual([]);
  });

  it('reads the family of a task spec as a fixture, and its workspace files', async () => {
    const task = await spec('examples/acme/generated/specs/task/acme-price-sheet-i01-duplicate-line.yaml');
    const deps = blockDependencies(task, 0);
    expect(deps.fixtures).toContain('family:acme-price-sheet');
    expect(deps.fixtures).toContain('catalog.csv');
    expect(deps.unknown).toBe(false);
  });

  it('lets a hand-written spec declare its dependencies and leave the unknown class', async () => {
    const upgrade = await spec('examples/acme/specs/conversations/plan-upgrade.yaml');
    const declared: Spec = {
      ...upgrade,
      metadata: {
        ...upgrade.metadata,
        depends: { tools: ['order.create'], stages: ['recap'], atoms: ['a-12'] },
      },
    };
    const deps = blockDependencies(declared, 0);
    expect(deps.unknown).toBe(false);
    expect(deps.tools.map((tool) => tool.label)).toEqual(['catalog.search', 'order.create']);
    expect(deps.stages).toContain('recap');
    expect(deps.atoms).toEqual(['a-12']);
    expect(deps.atomsKnown).toBe(true);
  });

  it('keeps the gate reading of the Then fields', async () => {
    const upgrade = await spec('examples/acme/specs/conversations/plan-upgrade.yaml');
    expect(thenFields(upgrade, 1)).toEqual(blockDependencies(upgrade, 1).fields);
    expect(thenFields(upgrade, 1)).toEqual(['tools', 'stage', 'text', 'lang', 'format']);
  });
});
