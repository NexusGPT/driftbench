import { describe, expect, it } from 'vitest';
import { findingsOf, REACHING, ROLE, viewOf } from './model-view';
import { exactLinks, expectedOf, MATRIX, specOf } from './spec';

/**
 * The oracle has two sources that must agree: the counts of spec.ts, derived from the spec, and the findings of
 * model-view.ts, derived from the parts and links the spec means. They share no code. When a reader of the common
 * model gives a view, the same `findingsOf` judges it.
 */
describe('findings from parts and links agree with the spec', () => {
  it.each(MATRIX)('seed $seed, $mismatch of the links in other letters', (variant) => {
    const spec = specOf(variant.seed, variant.mismatch);
    const expected = expectedOf(spec);
    const found = findingsOf(viewOf(spec));
    expect(found.unresolved).toHaveLength(expected.unresolved);
    expect(found.orphans).toHaveLength(expected.orphans);
    expect(found.unreachable).toEqual([]);
  });

  it.each(MATRIX)('writing every link as its target is stored leaves no finding (seed $seed)', (variant) => {
    const found = findingsOf(viewOf(exactLinks(specOf(variant.seed, variant.mismatch))));
    expect(found).toEqual({ unresolved: [], orphans: [], unreachable: [] });
  });

  it('a part with no link into reach is an orphan, and one only a non-loaded part points at is unreachable', () => {
    const view = viewOf(specOf(7, 0));
    const lone = {
      ...view.parts[1],
      id: 'reference:lone',
      type: 'reference',
      aspects: ROLE.reference.aspects,
      loaded: ROLE.reference.loaded,
    };
    const behind = { ...lone, id: 'reference:behind' };
    const links = [
      ...view.links,
      {
        from: 'reference:lone',
        to: 'reference:behind',
        kind: 'references' as const,
        provenance: { reader: 'expected', file: 'x' },
        confidence: 1,
      },
    ];
    const found = findingsOf({ ...view, parts: [...view.parts, lone, behind] as typeof view.parts, links });
    expect(found.orphans).toContain('reference:lone');
    expect(found.unreachable).toContain('reference:behind');
  });

  it('every link kind that brings a part into reach is declared once', () => {
    expect(new Set(REACHING).size).toBe(REACHING.length);
  });
});
