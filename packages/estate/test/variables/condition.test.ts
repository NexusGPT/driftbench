import { validateVariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { estateToVariables, ledgerResolver, readCondition } from '../../src/variables';
import { atom, HALL, mapOf } from './support';

describe('the condition reader: a closed grammar of comparisons with a number', () => {
  it.each([
    ['A shipment is late by more than two days', { comparison: 'gt', limit: 2, unit: 'days' }],
    ['The total difference is above 50.00 EUR', { comparison: 'gt', limit: 50, unit: 'eur' }],
    ['A boat stays at least 3 nights', { comparison: 'ge', limit: 3, unit: 'nights' }],
    ['A reply is under 120 words', { comparison: 'lt', limit: 120, unit: 'words' }],
    ['No more than one question per reply', { comparison: 'le', limit: 1, unit: 'question' }],
    ['At most 0.5 litres are poured', { comparison: 'le', limit: 0.5, unit: 'litres' }],
    ['A mooring waits fewer than ten minutes', { comparison: 'lt', limit: 10, unit: 'minutes' }],
    ['A fee above 500', { comparison: 'gt', limit: 500 }],
  ])('reads %s', (text, expected) => {
    expect(readCondition(text)).toMatchObject(expected);
  });

  it.each([
    'A tool failed twice in a row',
    'A shipment is late',
    'The user says stop',
    'A crate is more than two days late and under ten kilos',
    'Over the moon',
    'More than a few days',
  ])('reads nothing from %s: no number, or two comparisons, or no quantity', (text) => {
    expect(readCondition(text)).toBeUndefined();
  });
});

describe('the subject of a condition is the words up to its number and unit', () => {
  it.each([
    ['A credit note above 500.00 EUR waits for approval', 'A credit note above 500.00 EUR'],
    ['A shipment is late by more than two days', 'A shipment is late by more than two days'],
    ['A reply is under 120 words, say the editors', 'A reply is under 120 words'],
    ['A fee above 500 and a late fee', 'A fee above 500'],
  ])('%s', (text, subject) => {
    expect(readCondition(text)?.subject).toBe(subject);
  });
});

describe('a condition with a number becomes a variable with a boundary', () => {
  const OVERDUE = 'When a mooring is overdue by more than two days, warn the keeper and offer a reminder.';
  const resolver = () => ledgerResolver(new Map(Object.entries(HALL)));

  it('writes the three values, the edge between them, and the limit with its comparison and unit', () => {
    const result = estateToVariables(
      mapOf([atom({ quote: OVERDUE, situation: 'A mooring is overdue by more than two days' })]),
      resolver(),
    );
    const variable = result.store.variables.find((v) => v.id.startsWith('condition.'));
    expect(variable).toMatchObject({
      id: 'condition.a_mooring_is_overdue_by_more_than_two_days',
      title: 'A mooring is overdue by more than two days',
      kind: 'data',
      role: 'detail',
      produced_by: 'model',
    });
    expect(variable?.values.map((v) => v.id)).toEqual(['above_2', 'at_2', 'below_2']);
    expect(variable?.boundaries).toEqual([
      {
        holds: 'above_2',
        fails: 'below_2',
        edge: 'at_2',
        limit: 2,
        comparison: 'gt',
        unit: 'days',
        provenance: [
          {
            kind: 'quote',
            path: 'CLAUDE.md',
            quote: OVERDUE,
            ledger: expect.stringMatching(/^[a-z2-7]{10}$/),
          },
        ],
      },
    ]);
    for (const value of variable?.values ?? [])
      expect(value.provenance?.[0]).toMatchObject({ kind: 'quote', quote: OVERDUE });
    expect(validateVariableStore(result.store).ok).toBe(true);
  });

  it('puts the failing side below the limit for "more than", and above it for "at most"', () => {
    const more = estateToVariables(
      mapOf([atom({ quote: OVERDUE, situation: 'A mooring is overdue by more than two days' })]),
      resolver(),
    );
    const most = estateToVariables(
      mapOf([
        atom({
          quote: 'A boat that stays at most 3 nights pays the short fee.',
          situation: 'A boat stays at most 3 nights',
        }),
      ]),
      resolver(),
    );
    expect(more.store.variables.at(-1)?.boundaries?.[0]).toMatchObject({
      holds: 'above_2',
      fails: 'below_2',
    });
    expect(most.store.variables.at(-1)?.boundaries?.[0]).toMatchObject({
      holds: 'below_3',
      fails: 'above_3',
      comparison: 'le',
    });
    expect(validateVariableStore(most.store).ok).toBe(true);
  });

  it('keeps two atoms that state the same condition as one variable with both quotes', () => {
    const result = estateToVariables(
      mapOf([
        atom({ quote: OVERDUE, situation: 'A mooring is overdue by more than two days' }),
        atom({
          quote: 'A boat that stays at most 3 nights pays the short fee.',
          situation: 'A mooring is overdue by more than two days',
          title: 'Same condition',
        }),
      ]),
      resolver(),
    );
    const variables = result.store.variables.filter((v) => v.id.startsWith('condition.'));
    expect(variables).toHaveLength(1);
    expect(variables[0]?.boundaries?.[0]?.provenance).toHaveLength(2);
  });

  it('refuses the condition of an atom whose quote has no ledger unit, and writes no variable for it', () => {
    const result = estateToVariables(
      mapOf([atom({ quote: 'Not in the hall.', situation: 'A mooring is overdue by more than two days' })]),
      resolver(),
    );
    expect(result.store.variables.filter((v) => v.id.startsWith('condition.'))).toEqual([]);
    expect(result.refused.some((entry) => entry.variable.startsWith('condition.'))).toBe(true);
  });
});
