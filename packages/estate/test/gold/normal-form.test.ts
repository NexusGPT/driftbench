import { describe, expect, it } from 'vitest';
import { normalForm, type Reading } from './normal-form';

const reading = (limit: number, comparison: Reading['comparison'], role: Reading['role']): Reading => ({
  limit,
  comparison,
  role,
});

describe('the normal form of a limit', () => {
  it.each([
    ['lt', 'ge'],
    ['le', 'gt'],
    ['gt', 'le'],
    ['ge', 'lt'],
  ] as const)('turns a trigger %s on a prohibition into the constraint %s', (from, to) => {
    expect(normalForm(reading(4, from, 'trigger'), true)).toEqual(reading(4, to, 'constraint'));
  });

  it('makes the two readings of one prohibition equal', () => {
    // Do not do the act for fewer than four items: applies when lt 4, compliant when ge 4.
    expect(normalForm(reading(4, 'lt', 'trigger'), true)).toEqual(normalForm(reading(4, 'ge', 'constraint'), true));
  });

  it('leaves a constraint on a prohibition as it is', () => {
    expect(normalForm(reading(5, 'ge', 'constraint'), true)).toEqual(reading(5, 'ge', 'constraint'));
  });

  it('leaves every reading of a rule that is not a prohibition as it is', () => {
    for (const comparison of ['lt', 'le', 'gt', 'ge'] as const) {
      expect(normalForm(reading(4, comparison, 'trigger'), false)).toEqual(reading(4, comparison, 'trigger'));
    }
  });

  it('keeps readings that are not equivalent apart', () => {
    const forbidden = (value: Reading) => JSON.stringify(normalForm(value, true));
    // A trigger ge 5 on a prohibition is the constraint lt 5: not the constraint ge 5.
    expect(forbidden(reading(5, 'ge', 'trigger'))).not.toBe(forbidden(reading(5, 'ge', 'constraint')));
    // Another number, another comparison that is not the complement.
    expect(forbidden(reading(4, 'lt', 'trigger'))).not.toBe(forbidden(reading(5, 'ge', 'constraint')));
    expect(forbidden(reading(4, 'lt', 'trigger'))).not.toBe(forbidden(reading(4, 'gt', 'constraint')));
    // On a rule that is not a prohibition, a trigger and a constraint of the same comparison stay different.
    expect(JSON.stringify(normalForm(reading(4, 'lt', 'trigger'), false))).not.toBe(
      JSON.stringify(normalForm(reading(4, 'ge', 'constraint'), false)),
    );
  });
});
