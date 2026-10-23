import { describe, expect, it } from 'vitest';
import { parseUnitsTruth } from './units-estate';

/**
 * The truth file of a units-table estate is read with the failsafe schema, so every scalar is a string: an id such as
 * 13438124e4 (a number in the default schema) keeps its characters whether or not it is quoted. These tests pin that.
 */

const IDS = ['13438124e4', '774723e072', '9651728e48', '1234567890'];

const truth = (quote: (id: string) => string): string =>
  [
    'version: 1',
    'estate: unit-test',
    'units:',
    ...IDS.flatMap((id) => [`  - id: ${quote(id)}`, '    file: F.md', `    text: "unit ${id}"`]),
    'limits:',
    ...IDS.flatMap((id) => [
      `  - unit: ${quote(id)}`,
      '    limit: 5',
      '    comparison: le',
      '    role: constraint',
      `    governs: ${quote(id)}`,
    ]),
    'non_limits: []',
    '',
  ].join('\n');

describe('the units truth reads ids as strings', () => {
  it.each([
    ['unquoted', (id: string) => id],
    ['quoted', (id: string) => `"${id}"`],
  ])('when the ids are %s', (_name, quote) => {
    const parsed = parseUnitsTruth(truth(quote));
    expect(parsed.units.map((unit) => unit.id)).toEqual(IDS);
    expect(parsed.units.map((unit) => typeof unit.id)).toEqual(IDS.map(() => 'string'));
    expect(parsed.limits.map((limit) => limit.unit)).toEqual(IDS);
    expect(parsed.limits.map((limit) => limit.governs)).toEqual(IDS);
  });

  it('keeps the exact characters of 13438124e4, never the number 134381240000', () => {
    const parsed = parseUnitsTruth(truth((id) => id));
    expect(parsed.units[0]?.id).toBe('13438124e4');
    expect(parsed.units[0]?.id).not.toBe(String(Number('13438124e4')));
  });

  it('names a limit whose unit is no unit, by its list position', () => {
    const text = truth((id) => id).replace(/(limits:\n {2}- unit: )13438124e4/, '$113438124e5');
    expect(() => parseUnitsTruth(text)).toThrow(/limits\[0\].*13438124e5 is not a unit/);
  });
});
