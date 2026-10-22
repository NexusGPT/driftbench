import { describe, expect, it } from 'vitest';
import { coverageCell, coverageTruth } from '../../src/ladders/estate/bank/stats';

// docs/estate.md section 5 ("A map may record `documents`"): a reference whose target is a navigation document
// (any role but `normative`) is a place to look; `estate stats` leaves it out of the coverage counts and reports
// their number. Invented map: three approved references, one of them to a template.
const MAP = {
  atoms: [
    { id: 'reference.a', kind: 'reference', approved: true, fields: { path: 'docs/rules.md' } },
    { id: 'reference.b', kind: 'reference', approved: true, fields: { path: './templates/report.md' } },
    { id: 'reference.c', kind: 'reference', approved: true, fields: { path: 'docs/limits.md' } },
    { id: 'skill.a', kind: 'skill', approved: true, fields: { name: 'a' } },
  ],
  documents: [
    { path: 'docs/rules.md', role: 'normative' },
    { path: 'templates/report.md', role: 'template' },
    { path: 'docs/limits.md', role: 'normative' },
  ],
};
const SPECS = [{ complete: true, atoms: ['reference.a', 'reference.b'] }];

describe('estate.stats leaves references to navigation documents out, and checks their reported number', () => {
  it('counts only the references to normative documents', () => {
    const { truth, navigation } = coverageTruth(MAP, SPECS);
    expect(truth.reference).toEqual({ atoms: 2, tested: 1, enforced: 0 });
    expect(navigation).toBe(1);
    // A map with no documents changes nothing.
    expect(coverageTruth({ atoms: MAP.atoms }, SPECS)).toEqual({
      truth: { reference: { atoms: 3, tested: 2, enforced: 0 }, skill: { atoms: 1, tested: 0, enforced: 0 } },
      navigation: 0,
    });
  });

  it('fails a reference cell whose reported number of left-out references differs, or is missing', () => {
    const want = { atoms: 2, tested: 1, enforced: 0 };
    const got = { atoms: 2, tested: 1, enforced: 0 };
    expect(coverageCell('reference', 'tested', want, got, 1, 1).pass).toBe(true);
    expect(coverageCell('reference', 'tested', want, got, 1, undefined).pass).toBe(false);
    expect(coverageCell('reference', 'enforced', want, got, 1, 2).pass).toBe(false);
    // Leaving every reference out would hide them: the reported number must match the oracle's.
    expect(coverageCell('reference', 'tested', { atoms: 0, tested: 0, enforced: 0 }, {}, 1, 3).pass).toBe(
      false,
    );
    // No reference left out: an absent number reads as none.
    expect(coverageCell('reference', 'tested', want, got, 0, undefined).pass).toBe(true);
    // Another kind does not carry the number.
    expect(coverageCell('skill', 'tested', want, got, 1, undefined).pass).toBe(true);
  });
});
