import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeReader,
  lintEstate,
  MODULE_NOT_IN_ESTATE,
  moduleEntries,
  referenceGraph,
  scanEstate,
} from '../../src/index';
import {
  blankPython,
  pythonImports,
  scriptImports,
  scriptSpecifiers,
  tokenizeScript,
} from '../../src/refs/modules';
import { estate, NOW } from '../support';

const file = (path: string, text: string) => ({ path, text, kind: 'other' as const });

describe('Python import statements', () => {
  it('blanks comments and the contents of strings, keeping lines and positions', () => {
    const text = '# import a\nx = "import b"\n"""\nimport c\n"""\nimport d  # import e\n';
    const blank = blankPython(text);
    expect(blank.length).toBe(text.length);
    expect(blank.split('\n').length).toBe(text.split('\n').length);
    expect(blank).not.toMatch(/import [abce]\b/);
    expect(blank).toMatch(/import d/);
  });

  it('reads every form of import and the names a from-import may take as modules', () => {
    const text = [
      'import os, helpers as h',
      'import pkg.sub.mod',
      'from lib.tools import run, other as o',
      'from . import shared',
      'from .. import up',
      'from .near import fn',
      'from pkg import (',
      '    first,',
      '    second,',
      ')',
      'def main():',
      '    import inner',
      'try: import maybe',
      'except ImportError: pass',
    ].join('\n');
    const written = pythonImports(file('hooks/run.py', text)).map((m) => [m.written, m.optional === true]);
    expect(written).toEqual([
      ['os', false],
      ['helpers', false],
      ['pkg.sub.mod', false],
      ['inner', false],
      ['maybe', false],
      ['lib.tools', false],
      ['lib.tools.run', true],
      ['lib.tools.other', true],
      ['.', true],
      ['.shared', true],
      ['..', true],
      ['..up', true],
      ['.near', false],
      ['.near.fn', true],
      ['pkg', false],
      ['pkg.first', true],
      ['pkg.second', true],
    ]);
  });

  it('gives the files a module can be, nearest first, and the packages that run with it', () => {
    const [mention] = pythonImports(file('hooks/run/entry.py', 'import lib.tools\n'));
    expect(mention?.candidates?.slice(0, 4)).toEqual([
      { path: 'hooks/run/lib/tools.py', companions: ['hooks/run/lib/__init__.py'] },
      { path: 'hooks/run/lib/tools/__init__.py', companions: ['hooks/run/lib/__init__.py'] },
      { path: 'hooks/lib/tools.py', companions: ['hooks/lib/__init__.py'] },
      { path: 'hooks/lib/tools/__init__.py', companions: ['hooks/lib/__init__.py'] },
    ]);
    const [relative] = pythonImports(file('hooks/run/entry.py', 'from ..shared import limit\n'));
    expect(relative?.candidates?.[0]).toEqual({
      path: 'hooks/shared.py',
      companions: ['hooks/__init__.py'],
    });
  });
});

describe('JavaScript and TypeScript import statements', () => {
  it('tokenizes without reading comments, and keeps the value of a string', () => {
    const tokens = tokenizeScript("// import a from './x';\n/* require('./y') */ const s = 'q';\n");
    expect(tokens.map((token) => `${token.kind}:${token.value}`)).toEqual([
      'word:const',
      'word:s',
      'punct:=',
      'string:q',
      'punct:;',
    ]);
  });

  it('reads import, export-from, dynamic import and require, and nothing a comment, a string or a regex holds', () => {
    const text = [
      "import a from './a.js';",
      "import { b } from '../b';",
      "import * as c from './c';",
      "import './side';",
      "import type { T } from './types';",
      "import legacy = require('./legacy');",
      "export * from './d';",
      "export { e } from './e';",
      'export const local = 1;',
      "const f = require('./f');",
      "const g = await import('./g');",
      'import {',
      '  h,',
      "} from './h';",
      "// import x from './commented';",
      "/* const y = require('./blocked'); */",
      'const s = "import z from \'./string\'";',
      "const r = /import from '.\\/regex'/;",
      "const t = `import u from './template'`;",
      "obj.import('./method');",
    ].join('\n');
    expect(scriptSpecifiers(text).map((found) => found.specifier)).toEqual([
      './a.js',
      '../b',
      './c',
      './side',
      './types',
      './legacy',
      './d',
      './e',
      './f',
      './g',
      './h',
    ]);
  });

  it('gives the files a relative specifier can be: itself, its source, an extension, a folder index', () => {
    const [mention] = scriptImports(file('hooks/run.ts', "import x from './lib/util.js';\n"));
    const paths = mention?.candidates?.map((candidate) => candidate.path) ?? [];
    expect(paths.slice(0, 4)).toEqual([
      'hooks/lib/util.js',
      'hooks/lib/util.ts',
      'hooks/lib/util.tsx',
      'hooks/lib/util.js.ts',
    ]);
    expect(paths).toContain('hooks/lib/util.js/index.ts');
    const [bare] = scriptImports(file('hooks/run.js', "import pad from 'left-pad';\n"));
    expect(bare?.candidates).toBeUndefined();
  });
});

const read = async (files: Record<string, string>) => new ClaudeCodeReader().read(await estate(files));

describe('module imports in the graph', () => {
  it('links a script to the module it imports, and to the packages that run with it', async () => {
    const raw = await read({
      'CLAUDE.md': '# Rules\n',
      '.claude/hooks/run/entry.py': 'import lib.tools\nfrom . import sibling\n',
      '.claude/hooks/run/lib/__init__.py': '',
      '.claude/hooks/run/lib/tools.py': 'VALUE = 1\n',
      '.claude/hooks/run/sibling.py': 'VALUE = 2\n',
    });
    const links = referenceGraph(raw).links.map((link) => `${link.kind} ${link.from} -> ${link.to}`);
    expect(links).toEqual([
      'includes .claude/hooks/run/entry.py -> .claude/hooks/run/lib/tools.py',
      'includes .claude/hooks/run/entry.py -> .claude/hooks/run/lib/__init__.py',
      'includes .claude/hooks/run/entry.py -> .claude/hooks/run/sibling.py',
    ]);
    const first = referenceGraph(raw).links[0];
    expect(first?.provenance).toEqual({
      reader: 'module-python',
      file: '.claude/hooks/run/entry.py',
      line: 1,
    });
  });

  it('keeps an import that leads to no file as unresolved, and the lint lists it as skipped with its reason', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/hooks/run.py': 'import json\nimport vanished\nfrom . import missing_name\n',
      '.claude/hooks/run.mjs': "import pad from 'left-pad';\nimport gone from './gone.js';\n",
    });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const unresolved = moduleEntries(raw)
      .filter((entry) => entry.outcome === 'unresolved')
      .map((entry) => entry.mention.written);
    expect(unresolved.sort()).toEqual(['./gone.js', 'json', 'left-pad', 'vanished']);
    // An optional name that is no module (`from . import name`) is not listed.
    expect(unresolved).not.toContain('.missing_name');
    expect(referenceGraph(raw).dangling).toEqual([]);
    const outcome = lintEstate(map, raw).outcomes.find((entry) => entry.check === 'MISSING_REFERENCE');
    expect(outcome?.findings).toEqual([]);
    expect(outcome?.coverage.skipped.map((skipped) => skipped.reason)).toEqual(
      Array(4).fill(MODULE_NOT_IN_ESTATE),
    );
    expect(outcome?.coverage.skipped.map((skipped) => skipped.what).sort()).toEqual([
      '.claude/hooks/run.mjs:1 left-pad',
      '.claude/hooks/run.mjs:2 ./gone.js',
      '.claude/hooks/run.py:1 json',
      '.claude/hooks/run.py:2 vanished',
    ]);
  });

  it('reads the imports of a file only when its part type declares the module rule', async () => {
    const raw = await read({
      'CLAUDE.md': '# Rules\n',
      'tools/run.py': 'import helpers\n',
      'tools/helpers.py': 'VALUE = 1\n',
      '.claude/hooks/guard.py': 'import helpers\n',
      '.claude/hooks/helpers.py': 'VALUE = 1\n',
    });
    // `tools/` is no part of the layout, so no type covers its files and none reads their imports.
    expect(moduleEntries(raw).map((entry) => entry.from)).toEqual(['.claude/hooks/guard.py']);
  });
});
