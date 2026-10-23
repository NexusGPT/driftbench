// The rule of fix 2, stated over parts and links:
//
//   A path a part's text writes (a code span, a link destination, a table cell, a quoted name) is a `references`
//   link from that part to the file it leads to. A path that leads to no file is an unresolved link, and the
//   references check fails on it. Text that only looks like a path (an example in a fence, a URL, a glob, a
//   placeholder, a version, a command) is no link. Nothing but the syntax of a path decides.
//
// Expectations come from that rule and from the way a person reads a path (relative to the naming file, or from the
// root of the estate), never from what the product printed. They are red on release/next today: a scan with no
// model reads no reference at all.
import { describe, expect, it } from 'vitest';
import { from, orphans, outcome, resolvedLink, shape, unresolvedLinks } from './links';
import { observe } from './observe';
import {
  CASINGS,
  DECOYS,
  decoyEstate,
  type RefAxes,
  type RefMods,
  referenceEstate,
  referenceMatrix,
  undecidableBare,
} from './variants';
import { MENTION_LINK } from './vocabulary';

const MATRIX = referenceMatrix();
const ids = ['namer', 'target'];

async function read(axes: RefAxes, mods: RefMods = {}) {
  const built = referenceEstate(axes, mods);
  return { built, observed: await observe(built.files, built.parts, built.nest ? { nest: built.nest } : {}) };
}

describe('a path a part writes is a reference, over the whole matrix', () => {
  for (const axes of MATRIX) {
    if (undecidableBare(axes)) continue;
    const label = referenceEstate(axes).label;
    it(label, async () => {
      const { built, observed } = await read(axes);
      if (axes.exists) {
        expect(resolvedLink(observed, MENTION_LINK, 'namer', 'target')).toBe(true);
        expect(outcome(observed, 'references').status).toBe('pass');
        if (built.orphanObservable) expect(orphans(observed)).not.toContain('target');
      } else {
        expect(unresolvedLinks(observed, MENTION_LINK, 'namer')).toHaveLength(1);
        expect(outcome(observed, 'references').status).toBe('fail');
      }
      // The naming part is read by the model: it instructs.
      if (axes.namer !== 'skill-doc') expect(observed.aspects.get('namer')).toContain('instructs');
    });
  }
});

describe('text that looks like a path and is none gives no reference', () => {
  for (const decoy of DECOYS) {
    it(decoy.key, async () => {
      const built = decoyEstate(decoy.lines);
      const observed = await observe(built.files, built.parts);
      expect(from(observed, 'namer', MENTION_LINK)).toEqual([]);
      expect(outcome(observed, 'references').status).not.toBe('fail');
    });
  }
});

// Metamorphic: a change that must not alter what the read finds. One variant in six, so every place, syntax and
// value of each axis is met.
const SAMPLE = MATRIX.filter((axes, index) => index % 6 === 0 && !undecidableBare(axes));

describe('a change that must not alter the links', () => {
  const same = (name: string, mods: (axes: RefAxes) => RefMods | undefined) => {
    describe(name, () => {
      for (const axes of SAMPLE) {
        const modified = mods(axes);
        if (modified === undefined) continue;
        it(referenceEstate(axes).label, async () => {
          const before = await read(axes);
          const after = await read(axes, modified);
          expect(shape(after.observed, ids)).toEqual(shape(before.observed, ids));
          expect(shape(before.observed, ids).length).toBeGreaterThan(0);
        });
      }
    });
  };
  same('moving the root of the estate to another folder', () => ({ nest: ['alpha', 'beta', 'gamma'] }));
  same('adding unrelated parts', () => ({ size: 25 }));
  same('adding text above the naming line', () => ({ preamble: true }));
  same('changing the line ending', (axes) => ({ eol: axes.eol === 'lf' ? 'crlf' : 'lf' }));
  same('writing the name in every case, in the file and in the mention', (axes) => {
    const other = CASINGS[(CASINGS.indexOf(axes.casing) + 1) % CASINGS.length];
    return other === undefined ? undefined : { casing: other };
  });
  same('naming the file twice', () => ({ duplicate: true }));
  same('writing the path in another syntax', (axes) => {
    const swap = {
      'code-span': 'link',
      link: 'table-cell',
      'link-anchor': 'quoted',
      'table-cell': 'code-span',
      quoted: 'link',
    } as const;
    const syntax = swap[axes.syntax as keyof typeof swap];
    return syntax === undefined ? undefined : { syntax };
  });
});

describe('a change that must alter the links', () => {
  const REACHED = SAMPLE.filter((axes) => axes.exists);

  describe('deleting the named file turns the reference into a missing one and nothing else', () => {
    for (const axes of REACHED) {
      it(referenceEstate(axes).label, async () => {
        const before = await read(axes);
        const after = await read(axes, { exists: false });
        expect(resolvedLink(before.observed, MENTION_LINK, 'namer', 'target')).toBe(true);
        expect(unresolvedLinks(after.observed, MENTION_LINK, 'namer')).toHaveLength(1);
        expect(outcome(before.observed, 'references').status).toBe('pass');
        expect(outcome(after.observed, 'references').status).toBe('fail');
      });
    }
  });

  describe('deleting the line that names the file removes the link, and the file is then unreferenced', () => {
    for (const axes of REACHED) {
      it(referenceEstate(axes).label, async () => {
        const before = await read(axes);
        const { built, observed } = await read(axes, { omitNaming: true });
        expect(resolvedLink(before.observed, MENTION_LINK, 'namer', 'target')).toBe(true);
        expect(from(observed, 'namer', MENTION_LINK)).toEqual([]);
        if (built.orphanObservable) expect(orphans(observed)).toContain('target');
      });
    }
  });

  describe('putting the line in a fenced block removes the link', () => {
    for (const axes of REACHED) {
      it(referenceEstate(axes).label, async () => {
        const before = await read(axes);
        const { observed } = await read(axes, { fenced: true });
        expect(resolvedLink(before.observed, MENTION_LINK, 'namer', 'target')).toBe(true);
        expect(from(observed, 'namer', MENTION_LINK)).toEqual([]);
      });
    }
  });
});
