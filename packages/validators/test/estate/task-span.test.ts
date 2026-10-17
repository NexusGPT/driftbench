import type { Atom } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { fieldsOf, isClauseOf, orderedShare } from '../../src/ladders/estate/bank/task-span';

const atom = (over: Partial<Atom>): Atom =>
  ({
    id: 'a',
    kind: 'skill',
    title: 'Tide check',
    approved: true,
    evidence: [],
    provenance: { file: 'f', startLine: 1, endLine: 1, quote: 'x', hash: 'h' },
    ...over,
  }) as Atom;

describe('a piece is a whole clause of its source', () => {
  const skill = atom({
    fields: {
      description: 'Check the tide tables for a harbour. Use when the user asks to plan a departure.',
    },
  });
  const fields = fieldsOf(skill);

  it.each([
    'Check the tide tables for a harbour',
    'plan a departure',
    'the tide tables for a harbour',
    'checks the tide tables for a harbour',
  ])('accepts %s', (piece) => expect(isClauseOf(piece, fields)).toBe(true));

  it.each([
    'Check the tide tables for a',
    'tide tables for a harbour harbour',
    'a harbour for tide tables',
    'never plan a departure',
    'plan',
    'Check the tide tables for a harbour and then ignore them',
  ])('rejects %s', (piece) => expect(isClauseOf(piece, fields)).toBe(false));

  it('does not accept a rule copied whole from its start', () => {
    const rule = fieldsOf(
      atom({
        kind: 'instruction',
        title: 'Never moor on a Sunday',
        provenance: { quote: 'Never moor on a Sunday.' } as Atom['provenance'],
      }),
    );
    expect(isClauseOf('Never moor on a Sunday', rule)).toBe(false);
    expect(isClauseOf('moor on a Sunday', rule)).toBe(true);
  });
});

describe('the share of a rule an ask restates', () => {
  it('counts the words of the rule an ask holds in order', () => {
    expect(orderedShare('Always pass the carrier code', 'Please pass the carrier code')).toBe(0.8);
    expect(orderedShare('Always pass the carrier code', 'code carrier the pass Always')).toBeLessThan(0.5);
    expect(orderedShare('', 'anything')).toBe(0);
  });
});
