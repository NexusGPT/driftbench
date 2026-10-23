// The rule of fix 9, stated over parts and links, from the module rules of the languages:
//
//   A script's import of a module is an `includes` link from the script to the file the import leads to, by the
//   resolution rules of the language: Python looks for `name.py` or `name/__init__.py` from the script's folder and
//   by dots for a package, and a leading dot is relative to the script's package; JavaScript and TypeScript take a
//   specifier that starts with `./` or `../` as a path, add an extension or a folder index when the file is not named
//   exactly, and read `./a.js` as `a.ts` for TypeScript. A module of the standard library or an installed package
//   leads to no file of the estate: no link and no finding. An import written in a comment, a docstring or a string
//   is no import. A module its importer names is not an orphan.
import { describe, expect, it, vi } from 'vitest';
import { from, orphans, outcome, resolvedLink, shape } from './links';
import { observe } from './observe';
import {
  packageImports,
  SCRIPT_FORMS,
  type ScriptAxes,
  type ScriptMods,
  scriptDecoys,
  scriptEstate,
  scriptMatrix,
} from './variants-scripts';
import { SCRIPT_IMPORT_LINK } from './vocabulary';

// A test that reads a sample of estates, twice each, takes more than the default five seconds on a busy machine.
vi.setConfig({ testTimeout: 120_000 });

const MATRIX = scriptMatrix();
const ids = ['entry', 'module'];

async function read(axes: ScriptAxes, mods: ScriptMods = {}) {
  const built = scriptEstate(axes, mods);
  return { built, observed: await observe(built.files, built.parts, built.nest ? { nest: built.nest } : {}) };
}

describe('an import between scripts is an includes link, over the whole matrix', () => {
  for (const axes of MATRIX) {
    it(scriptEstate(axes).label, async () => {
      const { observed } = await read(axes);
      expect(resolvedLink(observed, SCRIPT_IMPORT_LINK, 'entry', 'module')).toBe(true);
      expect(orphans(observed)).not.toContain('module');
      expect(orphans(observed)).not.toContain('entry');
      expect(observed.aspects.get('entry')).toContain('executes');
      expect(observed.aspects.get('module')).toContain('executes');
    });
  }
});

describe('an import that leads to no file of the estate is no link and no finding', () => {
  for (const lang of ['python', 'javascript', 'typescript'] as const) {
    it(lang, async () => {
      const form = SCRIPT_FORMS.find((entry) => entry.lang === lang && entry.placement === 'sibling');
      if (!form) throw new Error(`no form for ${lang}`);
      const axes: ScriptAxes = { form, where: 'hook', eol: 'lf', size: 0, packageInit: false };
      const built = scriptEstate(axes, { omitImport: true });
      const entry = built.parts.find((part) => part.id === 'entry')?.path ?? '';
      const files = { ...built.files, [entry]: `${packageImports(lang).join('\n')}\n` };
      const observed = await observe(files, built.parts);
      expect(from(observed, 'entry', SCRIPT_IMPORT_LINK)).toEqual([]);
      expect(outcome(observed, 'references').status).not.toBe('fail');
      // The check could not look at those imports, and says so: each is listed as skipped, with its reason.
      const skipped = outcome(observed, 'references').coverage.skipped;
      expect(skipped).toHaveLength(3);
      expect(skipped.every((entry) => entry.reason === 'module-not-in-estate')).toBe(true);
    });
  }
});

describe('text that looks like an import and is none gives no includes link', () => {
  for (const lang of ['python', 'javascript', 'typescript'] as const) {
    const form = SCRIPT_FORMS.find((entry) => entry.lang === lang && entry.placement === 'sibling');
    if (!form) continue;
    const axes: ScriptAxes = { form, where: 'hook', eol: 'lf', size: 0, packageInit: false };
    for (const decoy of scriptDecoys(lang, { stem: 'x', pkg: 'y' })) {
      it(`${lang} ${decoy.key}`, async () => {
        const { observed } = await read(axes, { omitImport: true, decoy: decoy.key });
        // A comment or a string is no import. Whether a file a comment names counts as named is not asserted.
        expect(from(observed, 'entry', SCRIPT_IMPORT_LINK)).toEqual([]);
      });
    }
  }
});

const SAMPLE = MATRIX.filter((_, index) => index % 4 === 0);

describe('a change that must not alter the links', () => {
  const same = (name: string, mods: (axes: ScriptAxes) => ScriptMods) =>
    it(name, async () => {
      for (const axes of SAMPLE) {
        const before = await read(axes);
        const after = await read(axes, mods(axes));
        expect(shape(after.observed, ids), scriptEstate(axes).label).toEqual(shape(before.observed, ids));
        expect(shape(before.observed, ids).length).toBeGreaterThan(0);
      }
    });
  same('moving the root of the estate to another folder', () => ({ nest: ['alpha', 'beta'] }));
  same('renaming the folder that holds the scripts, and the one place that runs them', () => ({
    renameTree: 'tools',
  }));
  same('changing the line ending', (axes) => ({ eol: axes.eol === 'lf' ? 'crlf' : 'lf' }));
  same('adding unrelated parts and an unrelated script', () => ({ size: 20, extraScript: true }));
});

describe('equivalent ways to write one import give one link', () => {
  const groups: string[][] = [
    [
      'py-import',
      'py-import-as',
      'py-from-import',
      'py-from-dot-import',
      'py-from-dot-module',
      'py-comma-list',
      'py-multiline',
      'py-indented',
      'py-try',
    ],
    ['py-pkg-import', 'py-pkg-from', 'py-pkg-from-module', 'py-pkg-relative', 'py-pkg-relative-module'],
    ['py-parent-from', 'py-parent-module'],
    [
      'js-import-named',
      'js-import-default',
      'js-import-star',
      'js-import-bare',
      'js-export-star',
      'js-export-named',
      'js-require',
      'js-require-extensionless',
      'js-dynamic',
      'js-multiline',
    ],
    ['ts-import', 'ts-import-js-name', 'ts-import-type', 'ts-import-equals'],
  ];
  for (const group of groups) {
    it(group[0] ?? '', async () => {
      const shapes: string[][] = [];
      for (const key of group) {
        const form = SCRIPT_FORMS.find((entry) => entry.key === key);
        if (!form) throw new Error(`no form ${key}`);
        const axes: ScriptAxes = { form, where: 'hook', eol: 'lf', size: 0, packageInit: false };
        const { observed } = await read(axes);
        shapes.push(shape(observed, ids));
      }
      expect(shapes[0]?.length).toBeGreaterThan(0);
      for (const each of shapes) expect(each).toEqual(shapes[0]);
    });
  }
});

describe('a change that must alter the links', () => {
  it('dropping the import removes the link and leaves the module unreferenced', async () => {
    for (const axes of SAMPLE) {
      const before = await read(axes);
      const after = await read(axes, { omitImport: true });
      expect(
        resolvedLink(before.observed, SCRIPT_IMPORT_LINK, 'entry', 'module'),
        scriptEstate(axes).label,
      ).toBe(true);
      expect(from(after.observed, 'entry', SCRIPT_IMPORT_LINK), scriptEstate(axes).label).toEqual([]);
      expect(orphans(after.observed), scriptEstate(axes).label).toContain('module');
    }
  });

  it('deleting the module removes the link to it', async () => {
    for (const axes of SAMPLE) {
      const { observed } = await read(axes, { deleteModule: true });
      expect(resolvedLink(observed, SCRIPT_IMPORT_LINK, 'entry', 'module'), scriptEstate(axes).label).toBe(
        false,
      );
    }
  });
});
