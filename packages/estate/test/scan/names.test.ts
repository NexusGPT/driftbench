import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, ESTATE_CONFIG, lintEstate, locateNamed, scanEstate } from '../../src/index';
import type { EstateFile } from '../../src/scan/reader';
import { estate, NOW } from '../support';
import { CASES } from './cases';

const file = (path: string): EstateFile => ({ path, kind: 'other', text: '' });
const FILES = new Map(
  [
    '.claude/skills/a/SKILL.md',
    '.claude/skills/b/rules/section-scan.md',
    '.claude/skills/c/notes.md',
    '.claude/skills/d/notes.md',
    '.claude/skills/e/native/native.md',
    '.claude/skills/f/other/native.md',
  ].map((path) => [path, file(path)]),
);
const FROM = '.claude/skills/a/SKILL.md';

describe('a path named by its ending', () => {
  it('resolves a bare file name that one file of the estate has', () => {
    expect(locateNamed('section-scan.md', FROM, FILES)).toEqual({
      path: '.claude/skills/b/rules/section-scan.md',
      via: 'suffix',
    });
  });

  it('reports the candidates when several files share the name', () => {
    expect(locateNamed('notes.md', FROM, FILES)).toEqual({
      path: '.claude/skills/a/notes.md',
      via: 'none',
      candidates: ['.claude/skills/c/notes.md', '.claude/skills/d/notes.md'],
    });
  });

  it('decides on the longest ending that any file has, so a folder in the name breaks a tie', () => {
    expect(locateNamed('REF/native/native.md', FROM, FILES)).toEqual({
      path: '.claude/skills/e/native/native.md',
      via: 'suffix',
    });
    expect(locateNamed('gone.md', FROM, FILES)).toEqual({ path: '.claude/skills/a/gone.md', via: 'none' });
  });

  it('reads an alias before the ending, from the folder the alias stands for', () => {
    const aliases = { REF: ['.claude/skills/d'] };
    expect(locateNamed('REF/notes.md', FROM, FILES, { aliases })).toEqual({
      path: '.claude/skills/d/notes.md',
      via: 'alias',
    });
    expect(locateNamed('notes.md', FROM, FILES, { aliases }).candidates).toHaveLength(2);
  });
});

describe('alias tables', () => {
  it('reads an alias table file and the config aliases, the config winning on the same alias', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n\nRead `REF/guide.md` and `DOC/intro.md` first.\n',
      [ESTATE_CONFIG]: 'aliases:\n  DOC: .claude/docs\n  REF: [.claude/library]\n',
      '.claude/ALIASES.md':
        '| Alias | Path |\n|---|---|\n| REF | `.claude/skills/x/references/` |\n| SEE | ./.claude/see |\n',
      '.claude/library/guide.md': '# Guide\n',
      '.claude/docs/intro.md': '# Intro\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.aliases).toEqual({ REF: ['.claude/library'], SEE: ['.claude/see'], DOC: ['.claude/docs'] });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(
      map.atoms
        .filter((atom) => atom.kind === 'reference')
        .map((atom) => [atom.fields?.path, atom.fields?.resolvedBy]),
    ).toEqual([
      ['.claude/library/guide.md', 'alias'],
      ['.claude/docs/intro.md', 'alias'],
    ]);
  });

  it('notes aliases that are not a map of folders', async () => {
    const root = await estate({ 'CLAUDE.md': '# Rules\n', [ESTATE_CONFIG]: 'aliases: [REF]\n' });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.notes).toEqual([
      { file: ESTATE_CONFIG, message: 'aliases: must map each alias to a folder or a list of folders' },
    ]);
  });
});

describe('the reader-cases names', () => {
  it('resolves the bare name and the alias, and reports the shared name as ambiguous', async () => {
    const { map, raw } = await scanEstate({ root: CASES, reader: new ClaudeCodeReader(), now: NOW });
    const references = Object.fromEntries(
      map.atoms
        .filter((atom) => atom.kind === 'reference')
        .map((atom) => [`${atom.provenance.file}:${atom.provenance.startLine}`, atom.fields]),
    );
    expect(references['.claude/skills/shipment-tracker/SKILL.md:11']).toMatchObject({
      path: '.claude/skills/parcel-claims/references/claim-rules.md',
      exists: true,
      resolvedBy: 'suffix',
    });
    expect(references['.claude/skills/parcel-claims/SKILL.md:13']).toMatchObject({
      path: '.claude/skills/parcel-claims/references/notes.md',
      exists: true,
      resolvedBy: 'alias',
    });
    const ambiguous = lintEstate(map, raw).findings.filter(
      (finding) => finding.code === 'AMBIGUOUS_REFERENCE',
    );
    expect(ambiguous.map((finding) => finding.message)).toEqual([
      '.claude/skills/shipment-tracker/SKILL.md:12 names .claude/skills/shipment-tracker/notes.md, which several files could be: .claude/skills/parcel-claims/references/notes.md, .claude/skills/shipment-tracker/references/notes.md',
    ]);
    expect(lintEstate(map, raw).counts.MISSING_REFERENCE).toBe(0);
  });

  it('never offers a skipped file as a candidate for a name: the estate file alone resolves it', () => {
    const skipped = new Set([
      '.claude/hooks/tests/fixtures/section-scan.md',
      '.claude/node_modules/x/notes.md',
    ]);
    expect(locateNamed('section-scan.md', FROM, FILES, { skipped })).toEqual({
      path: '.claude/skills/b/rules/section-scan.md',
      via: 'suffix',
    });
    expect(locateNamed('notes.md', FROM, FILES, { skipped }).candidates).toEqual([
      '.claude/skills/c/notes.md',
      '.claude/skills/d/notes.md',
    ]);
    // Named by its place, a skipped file is still found.
    expect(locateNamed('.claude/node_modules/x/notes.md', FROM, FILES, { skipped })).toEqual({
      path: '.claude/node_modules/x/notes.md',
      via: 'place',
    });
  });
});
