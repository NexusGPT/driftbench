import { type VariableStore, variableProvenance } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';

/** A store file may omit its list of constraints (docs/variables.md: absent means every combination can occur). */
const store = {
  format: 1,
  agent: 'a',
  version: '1',
  variables: [
    {
      id: 'v',
      title: 'v',
      kind: 'data',
      role: 'axis',
      approved: true,
      values: [
        { id: 'x', title: 'x', provenance: [{ kind: 'quote', path: 'a.md', quote: 'a line' }] },
        { id: 'y', title: 'y' },
      ],
    },
  ],
} as unknown as VariableStore;

describe('variableProvenance on a store with no constraints list', () => {
  it('lists the entries of the variables and values, and does not throw', () => {
    expect(() => variableProvenance(store)).not.toThrow();
    expect(variableProvenance(store).map((item) => item.path)).toEqual(['variables.0.values.0.provenance.0']);
  });

  it('still lists the entries of a constraint when there is one', () => {
    const withConstraint = {
      ...store,
      constraints: [
        {
          forbid: { v: 'x' },
          reason: 'never',
          approved: true,
          provenance: [{ kind: 'owner', words: 'said so', date: '2026-10-21' }],
        },
      ],
    } as unknown as VariableStore;
    expect(variableProvenance(withConstraint).map((item) => item.path)).toEqual([
      'variables.0.values.0.provenance.0',
      'constraints.0.provenance.0',
    ]);
  });
});
