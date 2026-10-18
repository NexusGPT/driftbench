import {
  parseVariableStoreText,
  spaceMapToVariables,
  VariableScope,
  type VariableStore,
  validateVariableStore,
  variableScope,
  variablesToSpaceMap,
} from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { HAND, map } from './support';

/**
 * The scope of a variable: whether the thing it varies on is one fact of a whole conversation (a person's plan,
 * the channel) or can change from turn to turn (the mood of the person). A variable that states no scope is read
 * per conversation. All data here is invented.
 */

const store = (scope?: unknown) => ({
  format: 1,
  agent: 'demo',
  version: '1',
  variables: [
    {
      id: 'mood',
      title: 'How the person feels',
      kind: 'persona',
      role: 'axis',
      approved: true,
      ...(scope === undefined ? {} : { scope }),
      values: [
        { id: 'calm', title: 'calm' },
        { id: 'upset', title: 'upset' },
      ],
    },
    {
      id: 'channel',
      title: 'Where the conversation happens',
      kind: 'channel',
      role: 'axis',
      approved: true,
      values: [
        { id: 'chat', title: 'chat' },
        { id: 'mail', title: 'mail' },
      ],
    },
  ],
});

function loaded(raw: unknown): VariableStore {
  const result = validateVariableStore(raw);
  if (!result.ok) throw new Error(result.errors.map((issue) => `${issue.code} ${issue.path}`).join('; '));
  return result.store;
}

describe('the scope of a variable', () => {
  it('accepts turn and conversation, and keeps what was written', () => {
    expect(loaded(store('turn')).variables[0]?.scope).toBe('turn');
    expect(loaded(store('conversation')).variables[0]?.scope).toBe('conversation');
  });

  it('reads a variable with no scope per conversation, and does not write the default into the store', () => {
    const kept = loaded(store());
    expect(kept.variables[0]?.scope).toBeUndefined();
    expect(kept.variables.map((variable) => variableScope(variable))).toEqual([
      'conversation',
      'conversation',
    ]);
    expect(loaded(store('turn')).variables.map((variable) => variableScope(variable))).toEqual([
      'turn',
      'conversation',
    ]);
  });

  it('refuses a scope that is not one, at the variable that wrote it', () => {
    const result = validateVariableStore(store('sentence'));
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.map((issue) => issue.path)).toContain('variables.0.scope');
    expect(VariableScope.safeParse('turn').success).toBe(true);
    expect(VariableScope.safeParse('sentence').success).toBe(false);
  });

  it('reads a scope from YAML text', () => {
    const result = parseVariableStoreText(
      [
        'format: 1',
        'agent: demo',
        "version: '1'",
        'variables:',
        '  - id: mood',
        '    title: How the person feels',
        '    kind: persona',
        '    role: axis',
        '    approved: true',
        '    scope: turn',
        '    values:',
        '      - { id: calm, title: calm }',
        '      - { id: upset, title: upset }',
        '',
      ].join('\n'),
      'mood.yaml',
    );
    expect(result.ok && result.store.variables[0]?.scope).toBe('turn');
  });

  it('does not change the space map of a store: the scope stays in the store', () => {
    const withScope = variablesToSpaceMap(loaded(store('turn')));
    const without = variablesToSpaceMap(loaded(store()));
    expect(withScope.ok && without.ok && withScope.map).toEqual(without.ok && without.map);
  });

  it('never writes a scope when a space map becomes a store', () => {
    const converted = spaceMapToVariables(map(HAND));
    expect(converted.variables.every((variable) => variable.scope === undefined)).toBe(true);
  });
});
