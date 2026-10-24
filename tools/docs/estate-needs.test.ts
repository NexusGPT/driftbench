import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { estateBank } from '../../packages/validators/src/ladders/estate/bank';

const needs = readFileSync(new URL('../../validators/estate/NEEDS.md', import.meta.url), 'utf8');
const documented = [...needs.matchAll(/^\|\s*([a-z][a-z0-9.-]*)\s*\|\s*(\d+)\s*\|/gm)].map((row) => ({
  family: row[1] as string,
  count: Number(row[2]),
}));
// Enumerate metadata only: no family evaluation, fixture execution or model call.
const families = estateBank();

describe('estate NEEDS.md item counts', () => {
  it('documents every active bank family exactly once, with no extra families', () => {
    expect(families.length).toBeGreaterThan(0);
    expect(documented.map((row) => row.family).sort()).toEqual(families.map((family) => family.id).sort());
  });

  for (const family of families) {
    it(`${family.id} matches the bank item count`, () => {
      expect(documented.filter((row) => row.family === family.id)).toEqual([
        { family: family.id, count: family.items.length },
      ]);
    });
  }
});
