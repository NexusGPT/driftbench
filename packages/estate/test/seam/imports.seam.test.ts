// The rule of fix 6, stated over parts and links, from the documented rules of the runtime's `@` import (Claude Code
// memory documentation, "Import additional files"):
//
//   - an `@path` written anywhere in a standing file, outside a code span and a fenced block, imports the file;
//   - a relative path resolves relative to the file that holds the import, not the root of the estate;
//   - an imported file may import another; a cycle ends;
//   - a path wrapped in quotes is not an import; a space in a path is written with a backslash;
//   - an import that leads outside the estate (`~/x`, `/x`) is information, not a missing file;
//   - an import whose file does not exist is a missing reference;
//   - an imported file is loaded with its importer: it instructs.
//
// The documented depth limit is not asserted: the page says four hops and does not say whether the first counts.
import { describe, expect, it } from 'vitest';
import { externalLinks, from, outcome, resolvedLink, shape, unresolvedLinks } from './links';
import { observe } from './observe';
import { type ImportAxes, type ImportMods, importEstate, importMatrix } from './variants-imports';
import { IMPORT_LINK } from './vocabulary';

const MATRIX = importMatrix();

async function read(axes: ImportAxes, mods: ImportMods = {}) {
  const built = importEstate(axes, mods);
  return { built, observed: await observe(built.files, built.parts, built.nest ? { nest: built.nest } : {}) };
}

/** The importer is at the root, or the import is written from the importer's own folder: the file is where it says. */
function reachable(axes: ImportAxes): boolean {
  if (axes.target !== 'exists') return false;
  const nested = axes.importer.includes('/');
  return !(axes.place === 'root-only' && nested);
}

describe('an @ import is an includes link, over the whole matrix', () => {
  for (const axes of MATRIX) {
    const label = importEstate(axes).label;
    it(label, async () => {
      const { built, observed } = await read(axes);
      if (axes.target === 'outside-home' || axes.target === 'outside-absolute') {
        expect(externalLinks(observed, IMPORT_LINK, 'namer')).toHaveLength(1);
        expect(unresolvedLinks(observed, IMPORT_LINK, 'namer')).toEqual([]);
        expect(outcome(observed, 'references').status).not.toBe('fail');
        return;
      }
      if (axes.target === 'missing') {
        // The chain stands up to the file before the missing one; the import that leads nowhere is that file's.
        const owner = built.chain[built.chain.length - 1] ?? 'namer';
        expect(unresolvedLinks(observed, IMPORT_LINK, owner)).toHaveLength(1);
        expect(outcome(observed, 'references').status).toBe('fail');
        return;
      }
      if (!reachable(axes)) {
        // The file stands at the estate root, and the importer's own folder is not the root: the runtime loads nothing.
        expect(unresolvedLinks(observed, IMPORT_LINK, 'namer')).toHaveLength(1);
        expect(outcome(observed, 'references').status).toBe('fail');
        return;
      }
      // The chain of imports: each file includes the next.
      const sequence = ['namer', ...built.chain];
      for (let i = 0; i + 1 < sequence.length; i += 1)
        expect(resolvedLink(observed, IMPORT_LINK, sequence[i] ?? '', sequence[i + 1] ?? '')).toBe(true);
      for (const id of built.chain) expect(observed.aspects.get(id)).toContain('instructs');
      // The references check did not fail. Whether it passed or did not run for want of an input (every import here
      // is resolved, so none is a reference to read) is the read count of step 3, held in coverage.seam.test.ts.
      expect(outcome(observed, 'references').status).not.toBe('fail');
    });
  }
});

describe('text that is not an import gives no includes link', () => {
  const base: ImportAxes = {
    importer: 'CLAUDE.md',
    form: 'own-line',
    place: 'below',
    target: 'exists',
    depth: 0,
    eol: 'lf',
  };
  for (const decoy of ['code-span', 'fenced', 'quoted', 'label-code-span', 'alt-code-span'] as const) {
    it(decoy, async () => {
      const real = await read(base);
      const { observed } = await read(base, { decoy });
      expect(resolvedLink(real.observed, IMPORT_LINK, 'namer', 'last')).toBe(true);
      expect(from(observed, 'namer', IMPORT_LINK)).toEqual([]);
      // A fenced example is no mention of any kind.
      if (decoy === 'fenced') expect(from(observed, 'namer')).toEqual([]);
      expect(outcome(observed, 'references').status).not.toBe('fail');
    });
  }
});

const REACHED = MATRIX.filter((axes) => reachable(axes) && axes.depth > 0 && MATRIX.indexOf(axes) % 3 === 0);
const ids = ['namer', 'i1', 'i2', 'i3', 'last'];

describe('a change that must not alter the links', () => {
  const same = (name: string, mods: ImportMods) =>
    it(name, async () => {
      expect(REACHED.length).toBeGreaterThan(0);
      for (const axes of REACHED) {
        const before = await read(axes);
        const after = await read(axes, mods);
        expect(shape(after.observed, ids), importEstate(axes).label).toEqual(shape(before.observed, ids));
        expect(shape(before.observed, ids).length).toBeGreaterThan(0);
      }
    });
  same('moving the root of the estate to another folder', { nest: ['alpha', 'beta'] });
  same('adding text above the import', { preamble: true });
});

describe('a change that must alter the links', () => {
  it('deleting the last imported file turns the last import into a missing one', async () => {
    for (const axes of REACHED) {
      const label = importEstate(axes).label;
      const before = await read(axes);
      const after = await read(axes, { deleteLast: true });
      const owner = (await read(axes, { deleteLast: true })).built.chain.at(-1) ?? 'namer';
      expect(outcome(before.observed, 'references').status, label).not.toBe('fail');
      expect(unresolvedLinks(before.observed, IMPORT_LINK, owner), label).toEqual([]);
      expect(unresolvedLinks(after.observed, IMPORT_LINK, owner), label).toHaveLength(1);
      expect(outcome(after.observed, 'references').status, label).toBe('fail');
    }
  });

  it('a relative path is read from the importer: moving the importer into another folder loses the file', async () => {
    const axes: ImportAxes = {
      importer: 'CLAUDE.md',
      form: 'own-line',
      place: 'below',
      target: 'exists',
      depth: 0,
      eol: 'lf',
    };
    const before = await read(axes);
    // The file stays where it is; the importer, with the same written path, stands one folder down.
    const after = await read(axes, { importer: '.claude/CLAUDE.md' });
    expect(resolvedLink(before.observed, IMPORT_LINK, 'namer', 'last')).toBe(true);
    expect(resolvedLink(after.observed, IMPORT_LINK, 'namer', 'last')).toBe(false);
    expect(unresolvedLinks(after.observed, IMPORT_LINK, 'namer')).toHaveLength(1);
  });

  it('a cycle of imports ends, and every import in it is a link', async () => {
    const axes: ImportAxes = {
      importer: 'CLAUDE.md',
      form: 'own-line',
      place: 'below',
      target: 'exists',
      depth: 2,
      eol: 'lf',
    };
    const { observed } = await read(axes, { cycle: true });
    expect(resolvedLink(observed, IMPORT_LINK, 'namer', 'i1')).toBe(true);
    expect(resolvedLink(observed, IMPORT_LINK, 'i1', 'i2')).toBe(true);
    expect(resolvedLink(observed, IMPORT_LINK, 'i2', 'last')).toBe(true);
    expect(resolvedLink(observed, IMPORT_LINK, 'last', 'i1')).toBe(true);
  });
});

describe('a file that imports itself, or a pair that import each other', () => {
  for (const importer of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'] as const) {
    it(importer, async () => {
      const axes: ImportAxes = {
        importer,
        form: 'own-line',
        place: 'below',
        target: 'exists',
        depth: 1,
        eol: 'lf',
      };
      const { observed } = await read(axes, { self: true, cycle: true });
      // The importer includes itself: a cycle ends, and it is no missing file.
      expect(resolvedLink(observed, IMPORT_LINK, 'namer', 'namer')).toBe(true);
      // The last file imports the first back.
      expect(resolvedLink(observed, IMPORT_LINK, 'last', 'i1')).toBe(true);
      expect(unresolvedLinks(observed, IMPORT_LINK, 'namer')).toEqual([]);
      expect(outcome(observed, 'references').status).not.toBe('fail');
    });
  }
});
