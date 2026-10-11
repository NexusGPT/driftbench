import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeReader,
  DEFAULT_IGNORE,
  ESTATE_CONFIG,
  ignoreRule,
  lintEstate,
  resolveNamed,
  scanEstate,
} from '../../src/index';
import type { EstateFile } from '../../src/scan/reader';
import { estate, NOW } from '../support';
import { CASES } from './cases';

describe('the ignore list', () => {
  it('matches a glob like a .gitignore line: at any depth, folders whole, ** across folders', () => {
    const test = (pattern: string, path: string) => ignoreRule(pattern).test(path);
    expect(test('node_modules', '.claude/skills/a/node_modules/x/index.js')).toBe(true);
    expect(test('node_modules', '.claude/skills/a/my_node_modules.md')).toBe(false);
    expect(test('*.log', '.claude/hooks/run.log')).toBe(true);
    expect(test('*.log', '.claude/hooks/run.log.md')).toBe(false);
    expect(test('tests/fixtures', '.claude/hooks/tests/fixtures/a.json')).toBe(true);
    expect(test('tests/fixtures', '.claude/hooks/tests/a.json')).toBe(false);
    expect(test('hooks/**/tests', '.claude/hooks/tests/test_a.py')).toBe(true);
    expect(test('hooks/**/tests', '.claude/hooks/lib/tests/test_a.py')).toBe(true);
    expect(test('hooks/**/tests', '.claude/skills/x/tests/a.md')).toBe(false);
    expect(test('/.claude/skills/synced', '.claude/skills/synced/u/SKILL.md')).toBe(true);
    expect(test('/skills/synced', '.claude/skills/synced/u/SKILL.md')).toBe(false);
    expect(test('skills/synced', '.claude/skills/synced/u/SKILL.md')).toBe(true);
    expect([...DEFAULT_IGNORE]).toEqual([
      '.git',
      'node_modules',
      '__pycache__',
      '*.log',
      'tests/fixtures',
      'hooks/**/tests',
      'hooks/**/test',
      '.trash',
      'skills/synced',
    ]);
  });

  it('skips the defaults, the config list and the option, and counts each glob', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      [ESTATE_CONFIG]: 'ignore:\n  - skills/synced\n',
      '.claude/skills/a/SKILL.md': '---\nname: a\n---\n\nDo a.\n',
      '.claude/skills/synced/u1/SKILL.md': '---\nname: a\n---\n\nDo a.\n',
      '.claude/skills/synced/u2/SKILL.md': '---\nname: a\n---\n\nDo a.\n',
      '.claude/hooks/tests/test_a.py': 'pass\n',
      '.claude/hooks/tests/fixtures/e.json': '{}\n',
      '.claude/hooks/run.log': 'x\n',
      '.claude/hooks/__pycache__/a.pyc': 'x\n',
      '.claude/archive/old.md': '# Old\n',
    });
    const raw = await new ClaudeCodeReader({ ignore: ['archive'] }).read(root);
    expect(raw.files.map((file) => file.path)).toEqual(['CLAUDE.md', '.claude/skills/a/SKILL.md']);
    expect(raw.ignored?.patterns.filter((entry) => entry.files > 0)).toEqual([
      { pattern: '__pycache__', files: 1 },
      { pattern: '*.log', files: 1 },
      { pattern: 'hooks/**/tests', files: 2 },
      { pattern: 'skills/synced', files: 2 },
      { pattern: 'archive', files: 1 },
    ]);
    expect(raw.ignored?.paths).toContain('.claude/hooks/tests/fixtures/e.json');
    expect(raw.notes).toEqual([]);
  });

  it('counts the files under an ignored folder, links included, and notes a config whose ignore is not a list', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      [ESTATE_CONFIG]: 'ignore: skills/synced\n',
      '.claude/skills/a/SKILL.md': '---\nname: a\n---\n\nDo a.\n',
    });
    await mkdir(join(root, '.claude/node_modules'), { recursive: true });
    await symlink('../skills', join(root, '.claude/node_modules/loop'));
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.files.map((file) => file.path)).toEqual(['CLAUDE.md', '.claude/skills/a/SKILL.md']);
    expect(raw.ignored?.patterns.find((entry) => entry.pattern === 'node_modules')?.files).toBe(1);
    expect(raw.notes).toEqual([{ file: ESTATE_CONFIG, message: 'ignore: must be a list of globs' }]);
  });

  it('removes every orphan of the reader-cases files no runtime loads, and records the config list in the map', async () => {
    const { map, raw } = await scanEstate({ root: CASES, reader: new ClaudeCodeReader(), now: NOW });
    expect(raw.ignored?.patterns.filter((entry) => entry.files > 0).map((entry) => entry.pattern)).toEqual([
      'node_modules',
      '__pycache__',
      '*.log',
      'tests/fixtures',
      'hooks/**/tests',
      '.trash',
      'skills/synced',
      'archive',
    ]);
    // The one orphan left is the file a planted ambiguous reference leaves unnamed (cases.test.ts).
    expect(
      lintEstate(map, raw)
        .findings.filter((finding) => finding.code === 'ORPHAN')
        .map((finding) => finding.subject),
    ).toEqual(['.claude/skills/shipment-tracker/references/notes.md']);
    expect(map.ignore).toEqual(['archive']);
  });
});

describe('reference bases', () => {
  const file = (path: string): EstateFile => ({ path, kind: 'other', text: '' });
  const files = new Map(
    [
      '.claude/skills/a/SKILL.md',
      '.claude/skills/a/guide.md',
      '.claude/hooks/CHECK-REGISTRY.md',
      '.claude/skills/b/domains/GUIDE.md',
      'guide.md',
    ].map((path) => [path, file(path)]),
  );
  const bases = ['.claude', '.claude/skills'];

  it('tries the naming file folder, the root, then each base, in that order', () => {
    expect(resolveNamed('guide.md', '.claude/skills/a/SKILL.md', files, bases)).toBe(
      '.claude/skills/a/guide.md',
    );
    expect(resolveNamed('guide.md', 'CLAUDE.md', files, bases)).toBe('guide.md');
    expect(resolveNamed('hooks/CHECK-REGISTRY.md', 'CLAUDE.md', files, bases)).toBe(
      '.claude/hooks/CHECK-REGISTRY.md',
    );
    expect(resolveNamed('b/domains/GUIDE.md', '.claude/agents/x.md', files, bases)).toBe(
      '.claude/skills/b/domains/GUIDE.md',
    );
  });

  it('keeps the folder path when nothing resolves, and counts a skipped file as found', () => {
    expect(resolveNamed('gone.md', '.claude/skills/a/SKILL.md', files, bases)).toBe(
      '.claude/skills/a/gone.md',
    );
    expect(resolveNamed('.claude/gone.md', '.claude/skills/a/SKILL.md', files, bases)).toBe(
      '.claude/gone.md',
    );
    expect(
      resolveNamed(
        'tests/fixtures/e.json',
        'CLAUDE.md',
        files,
        bases,
        new Set(['.claude/tests/fixtures/e.json']),
      ),
    ).toBe('.claude/tests/fixtures/e.json');
  });

  it('finds the reader-cases references written from .claude and from .claude/skills', async () => {
    const { map } = await scanEstate({ root: CASES, reader: new ClaudeCodeReader(), now: NOW });
    const line = map.atoms.filter((atom) => atom.kind === 'reference' && atom.fields?.from === 'CLAUDE.md');
    expect(line.map((atom) => [atom.fields?.path, atom.fields?.exists])).toContainEqual([
      '.claude/guards/CHECK-REGISTRY.md',
      true,
    ]);
    expect(line.map((atom) => [atom.fields?.path, atom.fields?.exists])).toContainEqual([
      '.claude/skills/parcel-claims/references/claim-rules.md',
      true,
    ]);
    expect(
      map.atoms
        .filter((atom) => atom.kind === 'reference' && atom.fields?.exists === false)
        .map((atom) => atom.fields?.candidates),
    ).toEqual([
      [
        '.claude/skills/parcel-claims/references/notes.md',
        '.claude/skills/shipment-tracker/references/notes.md',
      ],
    ]);
  });

  it('marks a reference to a skipped file as found and ignored, not missing', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n\nRead `hooks/tests/fixtures/e.json` before a test run.\n',
      '.claude/hooks/tests/fixtures/e.json': '{}\n',
    });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const reference = map.atoms.find((atom) => atom.kind === 'reference');
    expect(reference?.fields).toMatchObject({
      path: '.claude/hooks/tests/fixtures/e.json',
      exists: true,
      ignored: true,
    });
    expect(lintEstate(map, raw).counts.MISSING_REFERENCE).toBe(0);
  });
});
