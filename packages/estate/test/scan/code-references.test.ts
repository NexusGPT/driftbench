import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate } from '../../src/index';
import { importedFiles } from '../../src/scan/code-names';
import { estate, NOW } from '../support';

/** A small estate of invented names, scanned with no model. */
async function scanned(files: Record<string, string>) {
  const root = await estate(files);
  return scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
}

const SKILL = (body: string[]) =>
  ['---', 'name: crate-sort', 'description: Sorts crates for the shelf team.', '---', '', ...body, ''].join(
    '\n',
  );

describe('the references code reads with no model', () => {
  it('reads a code span, a table cell and a link as references, and names the files they lead to', async () => {
    const { map, raw } = await scanned({
      'CLAUDE.md': '# Rules\n\n- Keep replies short.\n',
      '.claude/skills/crate-sort/SKILL.md': SKILL([
        '| Case | Read |',
        '|---|---|',
        '| unsure | `references/guide.md` |',
        'The list is in [the list](references/checklist.md).',
      ]),
      '.claude/skills/crate-sort/references/guide.md': '# Guide\n',
      '.claude/skills/crate-sort/references/checklist.md': '# Checklist\n',
      '.claude/skills/crate-sort/references/old.md': '# Old\n',
    });
    const references = map.atoms.filter((atom) => atom.kind === 'reference');
    expect(references.map((atom) => [atom.fields?.path, atom.fields?.exists, atom.producedBy])).toEqual([
      ['.claude/skills/crate-sort/references/guide.md', true, 'code'],
      ['.claude/skills/crate-sort/references/checklist.md', true, 'code'],
    ]);
    expect(map.referenceReader).toBe('code');
    const result = lintEstate(map, raw);
    expect(result.referenceChecksOff).toBe(false);
    expect(
      result.findings.filter((finding) => finding.code === 'ORPHAN').map((finding) => finding.subject),
    ).toEqual(['.claude/skills/crate-sort/references/old.md']);
  });

  it('reports a named file that does not exist as a missing reference', async () => {
    const { map, raw } = await scanned({
      'CLAUDE.md': '# Rules\n\n- Keep replies short.\n',
      '.claude/skills/crate-sort/SKILL.md': SKILL(['When unsure, open `references/absent.md`.']),
    });
    const missing = lintEstate(map, raw).findings.filter((finding) => finding.code === 'MISSING_REFERENCE');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain('.claude/skills/crate-sort/references/absent.md');
  });

  it('leaves out a name with no file type, a glob, a command and a placeholder path', async () => {
    const { map } = await scanned({
      'CLAUDE.md': '# Rules\n\n- Keep replies short.\n',
      '.claude/skills/crate-sort/SKILL.md': SKILL([
        'Use `crate-sort`, `references/*.md` and `python3 run.py` for the day.',
        'Write the answer to `out/<date>.md` when asked.',
      ]),
    });
    expect(map.atoms.filter((atom) => atom.kind === 'reference')).toEqual([]);
  });

  it('follows a standing import that exists silently and reports one it cannot read', async () => {
    const { map, raw } = await scanned({
      'CLAUDE.md': '# Rules\n\n@rules/standing.md\n@rules/absent.md\n@~/notes/personal.md\n',
      'rules/standing.md': '- Keep replies short.\n',
    });
    const references = map.atoms.filter((atom) => atom.kind === 'reference');
    expect(
      references.map((atom) => [atom.fields?.path, atom.fields?.exists, atom.fields?.external === true]),
    ).toEqual([
      ['rules/absent.md', false, false],
      ['~/notes/personal.md', false, true],
    ]);
    const codes = lintEstate(map, raw).findings.map((finding) => finding.code);
    expect(codes).toContain('MISSING_REFERENCE');
    expect(codes).toContain('EXTERNAL');
    expect(codes).not.toContain('ORPHAN');
  });

  it('judges no reference for a map that records no reader, and says so', async () => {
    const { map, raw } = await scanned({
      'CLAUDE.md': '# Rules\n\n- Keep replies short.\n',
      '.claude/skills/crate-sort/SKILL.md': SKILL(['Open `references/absent.md` when unsure.']),
      '.claude/skills/crate-sort/references/old.md': '# Old\n',
    });
    const { referenceReader: _dropped, ...legacy } = map;
    const result = lintEstate(legacy, raw);
    expect(result.referenceChecksOff).toBe(true);
    expect(
      result.findings.filter((finding) => finding.code === 'ORPHAN' || finding.code === 'MISSING_REFERENCE'),
    ).toEqual([]);
  });
});

describe('the imports between script files', () => {
  const paths = (...names: string[]) => new Set(names);

  it('reads Python imports, absolute and relative, and the modules a from-import names', () => {
    const known = paths(
      'hooks/run.py',
      'hooks/helpers.py',
      'hooks/lib/tools.py',
      'hooks/lib/__init__.py',
      'hooks/lib/shared.py',
      'hooks/lib/pkg/__init__.py',
    );
    const text = [
      'import os, helpers as h',
      'from lib.tools import go',
      'from lib import shared',
      'from lib.pkg import thing',
    ].join('\n');
    expect(importedFiles({ path: 'hooks/run.py', text }, known).sort()).toEqual([
      'hooks/helpers.py',
      'hooks/lib/__init__.py',
      'hooks/lib/pkg/__init__.py',
      'hooks/lib/shared.py',
      'hooks/lib/tools.py',
    ]);
    expect(
      importedFiles(
        { path: 'hooks/lib/tools.py', text: 'from .shared import limit\nfrom . import pkg\n' },
        known,
      ).sort(),
    ).toEqual(['hooks/lib/pkg/__init__.py', 'hooks/lib/shared.py']);
    expect(importedFiles({ path: 'hooks/lib/tools.py', text: 'from .. import helpers\n' }, known)).toEqual([
      'hooks/helpers.py',
    ]);
  });

  it('reads relative JavaScript and TypeScript specifiers, with or without the extension', () => {
    const known = paths('app/main.ts', 'app/util.ts', 'app/legacy.js', 'app/ui/index.tsx', 'app/data.json');
    const text = [
      "import { a } from './util.js';",
      "const legacy = require('./legacy');",
      "export * from './ui';",
      "const data = await import('./data.json');",
      "import 'left-pad';",
    ].join('\n');
    expect(importedFiles({ path: 'app/main.ts', text }, known).sort()).toEqual([
      'app/data.json',
      'app/legacy.js',
      'app/ui/index.tsx',
      'app/util.ts',
    ]);
  });

  it('names nothing for a module the estate does not hold', () => {
    expect(
      importedFiles(
        { path: 'hooks/run.py', text: 'import json\nfrom os import path\n' },
        paths('hooks/run.py'),
      ),
    ).toEqual([]);
  });
});
