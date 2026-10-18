import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { hiddenProposal, renderInventory } from '../../src/ladders/generator/render';

// Hand-written inventory entries distinguish an explicit read request from a private tool hint.
// The surrounding generated specification only supplies the rest of the renderer's required input.
function shelf() {
  const spec = hiddenSpec(1);
  const read = spec.tools.find((tool) => tool.role === 'read');
  const write = spec.tools.find((tool) => tool.sideEffect);
  if (!read || !write) throw new Error('missing surrounding tool schemas');
  spec.tools.push(
    { ...read, name: 'shelf_lookup', title: 'Read a shelf record' },
    { ...write, name: 'shelf_save', title: 'Save a shelf record' },
  );
  spec.behaviours.push(
    {
      id: 'shelf-explicit',
      title: 'Check the shelf with shelf_lookup before answering',
      tool: 'shelf_lookup',
    },
    { id: 'shelf-implicit', title: 'Check the shelf before answering', tool: 'shelf_lookup' },
    { id: 'shelf-write', title: 'Save the shelf with shelf_save', tool: 'shelf_save' },
    { id: 'shelf-unknown', title: 'Read with missing_shelf_tool', tool: 'missing_shelf_tool' },
  );
  return spec;
}

function calls(spec: ReturnType<typeof shelf>, behaviour: string) {
  return (
    hiddenProposal(spec).relations?.filter(
      (relation) =>
        relation.kind === 'uses_tool' &&
        relation.subject.dimension === 'behaviour' &&
        relation.subject.value === behaviour,
    ) ?? []
  );
}

describe('behaviour read calls rendered from explicit inventory text', () => {
  it('links an explicitly named read tool at every stage without moving, quoting the inventory', () => {
    const spec = shelf();
    const uses = calls(spec, 'shelf-explicit');
    expect(uses).toHaveLength(spec.stages.length);
    expect(
      uses.map((use) => {
        if (use.kind !== 'uses_tool') throw new Error('not a call');
        expect(use.tool).toBe('shelf_lookup');
        expect(use.to).toBe(use.stage);
        expect(use.evidence.source).toBe('./inventory.yaml');
        expect(renderInventory(spec)).toContain(use.evidence.quote);
        return use.stage;
      }),
    ).toEqual(spec.stages.map((stage) => stage.id));
  });

  it('does not turn a private tool hint into a call absent from the inventory text', () => {
    expect(calls(shelf(), 'shelf-implicit')).toEqual([]);
  });

  it('does not link side-effecting or unknown tools even when the text names them', () => {
    const spec = shelf();
    expect(calls(spec, 'shelf-write')).toEqual([]);
    expect(calls(spec, 'shelf-unknown')).toEqual([]);
  });
});
