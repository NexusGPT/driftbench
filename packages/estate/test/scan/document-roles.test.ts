import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeReader,
  lintEstate,
  parseEstateMapText,
  renderEstateMap,
  scanEstate,
} from '../../src/index';
import { estate, NOW } from '../support';

import { documents, roleEstateFiles } from './document-role-estate';

describe('document roles before rule extraction', () => {
  it('records roles in a round-trippable map and keeps non-normative documents as navigation only', async () => {
    const root = await estate(roleEstateFiles());
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const roles = new Map(map.documents?.map((document) => [document.path, document.role]));
    expect(Object.keys(documents).map((path) => roles.get(path))).toEqual([
      'changelog',
      'history',
      'template',
      'example',
      'journal',
      'fixture',
      'archive',
    ]);
    expect(roles.get('.claude/skills/editor/SKILL.md')).toBe('normative');
    for (const path of Object.keys(documents)) {
      expect(map.atoms.filter((atom) => atom.provenance.file === path)).toEqual([]);
      expect(raw.prose.some((chunk) => chunk.file === path)).toBe(false);
      expect(raw.files.some((file) => file.path === path)).toBe(true);
    }
    const parsed = parseEstateMapText(renderEstateMap(map));
    expect(parsed.ok && parsed.map.documents).toEqual(map.documents);
    const missing = lintEstate(map, raw).findings.filter((finding) => finding.code === 'MISSING_REFERENCE');
    expect(missing).toHaveLength(2);
    expect(missing.map((finding) => finding.message).join('\n')).toContain('missing-live/guide.md');
    expect(missing.map((finding) => finding.message).join('\n')).toContain('references/missing.md');
    expect(lintEstate(map, raw).counts.UNRESOLVED_REFERENCE).toBe(1);
    const hazards = map.atoms.filter((atom) => atom.kind === 'hazard');
    expect(hazards).toHaveLength(1);
    expect(hazards[0]?.provenance.file).toBe('.claude/skills/editor/SKILL.md');
  });

  it('does not infer a template or history from one placeholder or one dated operational rule', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n\nRead `.claude/guide.md`.\n',
      '.claude/guide.md':
        '# Deployment rules\n\n2025-01-01: After a compaction, read `policy.md` before deploying a page.\nUse `<slug>` as the output name.\n',
    });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.documents?.find((document) => document.path === '.claude/guide.md')?.role).toBe('normative');
    expect(
      raw.prose
        .filter((chunk) => chunk.file === '.claude/guide.md')
        .map((chunk) => chunk.text)
        .join('\n'),
    ).toContain('2025-01-01: After a compaction, read `policy.md` before deploying a page.');
  });

  it('keeps live rules after example sections and treats a template target as a real read gate', async () => {
    const root = await estate({
      'CLAUDE.md':
        '# Rules\n\nRead `.claude/templates/page.md` before editing a page.\n\n## Examples\n\nAfter a compaction, read `demo.md` before editing a page.\n\n## Required steps\n\nAfter a compaction, read `.claude/current.md` before editing a page.\n',
      '.claude/templates/page.md': '# Page\n\n<slug>\n',
      '.claude/current.md': '# Current\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'gate')).toHaveLength(2);
    expect(map.atoms.filter((atom) => atom.kind === 'hazard')).toHaveLength(1);
    expect(map.atoms.some((atom) => atom.fields?.path === '.claude/templates/page.md')).toBe(true);
  });

  it('does not report navigation-only documents as orphan or unreachable defects', async () => {
    const root = await estate({ 'CLAUDE.md': '# Rules\n', ...documents });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(lintEstate(map, raw).findings).toEqual([]);
  });

  it('unresolved bare names are informational; explicit missing paths still fail', async () => {
    const root = await estate({ 'CLAUDE.md': '# Rules\n\nRead `mystery.md`.\n' });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(lintEstate(map, raw).counts.UNRESOLVED_REFERENCE).toBe(1);
    expect(lintEstate(map, raw).counts.MISSING_REFERENCE).toBe(0);
    expect(lintEstate(map, raw).failed).toBe(false);
  });
});

describe('role structure independent of document names', () => {
  it('recognizes an arbitrary dated-entry title and an arbitrary fill-in title', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\nRead `.claude/notes.md`.\nRead `.claude/form.md`.\n',
      '.claude/notes.md':
        '# Engineering notes\n\n## 2024-09-17\nAfter a compaction, read `gone.md`.\n\n## 2024-09-18\nRead `gone-again.md`.\n',
      '.claude/form.md':
        '# Monthly output\n\nClient: {{client}}\nOwner: <owner>\nRead `fictional.md` before editing a page.\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.documents?.find((document) => document.path === '.claude/notes.md')?.role).toBe('history');
    expect(map.documents?.find((document) => document.path === '.claude/form.md')?.role).toBe('template');
    expect(map.atoms.filter((atom) => ['gate', 'hazard'].includes(atom.kind))).toEqual([]);
  });

  it('retains operational sections before an embedded dated history and variable paths in rules', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\nRead `.claude/guide.md`.\n',
      '.claude/guide.md':
        '# Editing\n\n## Required steps\nRead `live/required.md` before editing a page.\nUse `<slug>/output.md` as the output path.\nRead `{{folder}}/guide.md` before deploying a page.\n\n## History\n\n### 2025-01-01\nAfter a compaction, read `old.md`.\n\n### 2025-01-02\nRead `older.md`.\n',
    });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.documents?.find((document) => document.path === '.claude/guide.md')?.role).toBe('normative');
    expect(
      map.atoms.some((atom) => atom.kind === 'gate' && atom.provenance.quote.includes('live/required.md')),
    ).toBe(true);
    expect(
      map.atoms.filter((atom) => atom.kind === 'gate').every((atom) => atom.provenance.startLine < 8),
    ).toBe(true);
    expect(map.atoms.filter((atom) => atom.kind === 'hazard')).toHaveLength(0);
    expect(lintEstate(map, raw).counts.MISSING_REFERENCE).toBe(1);
  });
});

describe('authority at the generic reader and lint boundaries', () => {
  it('filters non-normative prose supplied by a different runtime reader', async () => {
    const root = await estate({ 'CLAUDE.md': '# Rules\n' });
    const raw = await new ClaudeCodeReader().read(root);
    const text = '# Examples\n\nAfter a compaction, read `missing.md` before editing a page.\n';
    raw.files = [{ path: 'manual.txt', kind: 'memory', text }];
    raw.prose = [{ id: 'manual', file: 'manual.txt', startLine: 1, endLine: 3, text }];
    const { map, raw: filtered } = await scanEstate({
      root,
      reader: { runtime: 'another-runtime', read: async () => raw },
      now: NOW,
    });
    expect(map.documents?.[0]?.role).toBe('example');
    expect(filtered.prose).toEqual([]);
    expect(map.atoms).toEqual([]);
  });

  it('reclassifies source authority when linting a legacy map without documents metadata', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\nRead `.claude/guide.md`.\n',
      '.claude/guide.md': '# Rules\nRead `missing-live/policy.md` before editing a page.\n',
    });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const { documents: ignoredDocuments, ...legacy } = map;
    const changed = {
      ...raw,
      files: raw.files.map((file) =>
        file.path === '.claude/guide.md'
          ? {
              ...file,
              document: undefined,
              text: '# Examples\nRead `missing-live/policy.md` before editing a page.\n',
            }
          : file,
      ),
    };
    expect(lintEstate(legacy, changed).findings).toEqual([]);
  });

  it('uses ignore patterns even for an excluded path without a physical test fixture', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\nRead `.claude/hidden-tests/absent.md`.\n',
      'driftbench.estate.yaml': 'ignore:\n  - hidden-tests\n',
    });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(lintEstate(map, raw).counts.MISSING_REFERENCE).toBe(0);
    expect(lintEstate(map, raw).failed).toBe(false);
  });
});

it('uses a declared unit folder as identity while retaining navigation roles below it', async () => {
  const root = await estate({
    'CLAUDE.md': '# Rules\nRead `.claude/skills/demo/SKILL.md`.\n',
    '.claude/skills/demo/SKILL.md':
      '---\nname: demo\n---\n# Live procedure\nRead `references/guide.md` before editing a page.\n',
    '.claude/skills/demo/references/guide.md': '# Live rules\nAfter a compaction, reload saved state.\n',
    '.claude/skills/demo/examples/example.md': '# Rules\nAfter a compaction, read `old.md`.\n',
  });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  expect(map.documents?.find((document) => document.path === '.claude/skills/demo/SKILL.md')?.role).toBe(
    'normative',
  );
  expect(map.documents?.find((document) => document.path.endsWith('/references/guide.md'))?.role).toBe(
    'normative',
  );
  expect(map.documents?.find((document) => document.path.endsWith('/examples/example.md'))?.role).toBe(
    'example',
  );
  expect(map.atoms.filter((atom) => atom.kind === 'hazard')).toHaveLength(1);
});

it('keeps the live clause after an illustrative prefix without linting the example path', async () => {
  const root = await estate({
    'CLAUDE.md':
      '# Rules\nExample: read `fictional/guide.md` before editing a page; read `.claude/live.md` before editing a page.\n',
    '.claude/live.md': '# Current rules\n',
  });
  const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  expect(lintEstate(map, raw).counts.MISSING_REFERENCE).toBe(0);
  expect(map.atoms.filter((atom) => atom.kind === 'reference').map((atom) => atom.fields?.path)).toEqual([
    '.claude/live.md',
  ]);
  expect(map.atoms.filter((atom) => atom.kind === 'gate')).toHaveLength(1);
  expect(raw.prose[0]?.text).not.toContain('fictional/guide.md');
});
