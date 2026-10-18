import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOC_RULES, DOC_SECTION } from '../../src/ladders/variables/bank/manifest/docs';
import { FAMILIES, STEMS } from '../../src/ladders/variables/bank/manifest/index';

const PAGE = readFileSync(fileURLToPath(new URL('../../../../docs/variables.md', import.meta.url)), 'utf8');

const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/ /g, '-');
const headings = new Set([...PAGE.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1] as string)));

/** The row of a family in "Rules by bank family": the rules the page lists for it. */
function familyRules(family: string): string[] {
  const row = PAGE.split('\n').find((line) => line.startsWith(`| ${family} |`));
  expect(row, `the page has a row for the family ${family}`).toBeTruthy();
  return [...(row as string).matchAll(/\bR\d+\b|\b(?:Boundaries|Provenance|Values|Approval|Limits)\b/g)].map(
    (m) => m[0],
  );
}

describe('the bank rests on docs/variables.md', () => {
  it('gives every stem its rules, and only stems', () => {
    expect(Object.keys(DOC_RULES).sort()).toEqual(STEMS.map((s) => s.id).sort());
    for (const stem of STEMS) expect(DOC_RULES[stem.id]?.length, stem.id).toBeGreaterThan(0);
  });

  it('finds every cited rule and section on the page', () => {
    for (const [id, rules] of Object.entries(DOC_RULES)) {
      for (const rule of rules) {
        const section = DOC_SECTION[rule];
        expect(section, `${id} cites ${rule}`).toBeTruthy();
        expect(headings.has(section as string), `${id}: section ${section} of ${rule}`).toBe(true);
        if (/^R\d+$/.test(rule)) expect(PAGE, `${id}: ${rule} is on the page`).toContain(`**${rule}: `);
      }
    }
  });

  it('lists the rules of every family on the page, and each stem stays inside its family row', () => {
    for (const family of FAMILIES) {
      const allowed = new Set(familyRules(family));
      expect(allowed.size, family).toBeGreaterThan(0);
      for (const stem of STEMS.filter((s) => s.family === family)) {
        for (const rule of DOC_RULES[stem.id] ?? [])
          expect(allowed.has(rule), `${stem.id} cites ${rule}, which the row of ${family} lacks`).toBe(true);
      }
    }
  });
});
