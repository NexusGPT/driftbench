import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeReader,
  lintEstate,
  parseEstateMapText,
  renderEstateMap,
  scanEstate,
} from '../../src/index';
import { estate, NOW, structurePointer } from '../support';

import { documents, roleEstateFiles } from './document-role-estate';

describe('document roles before rule extraction', () => {
  it('records roles in a round-trippable map and keeps non-normative documents as navigation only', async () => {
    const root = await estate(roleEstateFiles());
    const { map, raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
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
  });

  it('does not infer a template or history from one placeholder or one dated operational rule', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n\nRead `.claude/guide.md`.\n',
      '.claude/guide.md':
        '# Deployment rules\n\n2025-01-01: After a compaction, read `policy.md` before deploying a page.\nUse `<slug>` as the output name.\n',
    });
    const { map, raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    expect(map.documents?.find((document) => document.path === '.claude/guide.md')?.role).toBe('normative');
    expect(
      raw.prose
        .filter((chunk) => chunk.file === '.claude/guide.md')
        .map((chunk) => chunk.text)
        .join('\n'),
    ).toContain('2025-01-01: After a compaction, read `policy.md` before deploying a page.');
  });

  it('exempts records and stores from reachability and keeps loaded material subject to it', async () => {
    const root = await estate({ 'CLAUDE.md': '# Rules\n', ...documents });
    const { map, raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    const findings = lintEstate(map, raw).findings;
    expect(findings.map((finding) => `${finding.code} ${finding.subject}`).sort()).toEqual([
      'ORPHAN .claude/skills/editor/references/demo.md',
      'ORPHAN .claude/skills/editor/references/skeleton.md',
    ]);
  });

  it('resolves declared unit identifiers without inventing missing files from other inline values', async () => {
    const root = await estate({
      'CLAUDE.md':
        '# Rules\nLoad `formatter`.\nLoad the helper `proofreader`.\nRead this rule and print `done`.\nFor example, read `fictional-helper`.\nRead `<slug>`.\nRead `{{x}}`.\n',
      '.claude/skills/formatter/SKILL.md': '---\nname: formatter\n---\n# Formatting\n',
      '.claude/agents/proofreader.md': '---\nname: proofreader\n---\n# Proofreading\n',
    });
    const { map, raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    expect(lintEstate(map, raw).counts.UNRESOLVED_REFERENCE).toBe(0);
    expect(lintEstate(map, raw).counts.MISSING_REFERENCE).toBe(0);
    expect(map.atoms.filter((atom) => atom.kind === 'reference' && atom.fields?.exists === false)).toEqual(
      [],
    );
  });
});

it('does not reinterpret a filename as a unit identifier when a helper has the same name', async () => {
  const root = await estate({
    'CLAUDE.md': '# Rules\nRead `release.properties`.\nRead `sub/absent.txt`.\n',
    'release.properties': 'format=plain\n',
    '.claude/agents/release.md': '---\nname: release.properties\n---\n# Helper\n',
    '.claude/agents/absent.md': '---\nname: absent.txt\n---\n# Helper\n',
  });
  const { map, raw } = await scanEstate({
    root,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: structurePointer(),
  });
  expect(lintEstate(map, raw).counts.MISSING_REFERENCE).toBe(1);
  expect(lintEstate(map, raw).counts.UNRESOLVED_REFERENCE).toBe(0);
  expect(
    map.atoms
      .filter((atom) => atom.kind === 'reference')
      .map((atom) => [atom.fields?.path, atom.fields?.exists]),
  ).toEqual([
    ['release.properties', true],
    ['sub/absent.txt', false],
  ]);
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
    const { map } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    expect(map.documents?.find((document) => document.path === '.claude/notes.md')?.role).toBe('history');
    expect(map.documents?.find((document) => document.path === '.claude/form.md')?.role).toBe('template');
    expect(map.atoms.filter((atom) => ['gate', 'hazard'].includes(atom.kind))).toEqual([]);
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
      pointer: structurePointer(),
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
    const { map, raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
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
    const { map, raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    expect(lintEstate(map, raw).counts.MISSING_REFERENCE).toBe(0);
    expect(lintEstate(map, raw).failed).toBe(false);
  });
});

describe('a role never hides a defect that a live owner makes', () => {
  const live = {
    'CLAUDE.md': '# Rules\nRead `.claude/skills/editor/SKILL.md`.\n',
    '.claude/skills/editor/SKILL.md':
      '---\nname: editor\ndescription: Edit pages.\n---\n# Editing\nRead `references/named.md`.\n',
    '.claude/skills/editor/references/named.md': '# Current\n',
  };
  const log = '# Notes\n\n## 2025-01-01\nSomething happened.\n\n## 2025-01-02\nSomething else.\n';

  it('keeps an unnamed record inside a live skill as a finding and exempts one outside every skill', async () => {
    const root = await estate({
      ...live,
      '.claude/skills/editor/references/log.md': log,
      '.claude/notes/outside-log.md': log,
    });
    const { map, raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    const roles = new Map(map.documents?.map((document) => [document.path, document.role]));
    expect(roles.get('.claude/skills/editor/references/log.md')).toBe('history');
    expect(roles.get('.claude/notes/outside-log.md')).toBe('history');
    const subjects = lintEstate(map, raw)
      .findings.filter((finding) => finding.code === 'ORPHAN' || finding.code === 'UNREACHABLE')
      .map((finding) => finding.subject);
    expect(subjects).toEqual(['.claude/skills/editor/references/log.md']);
  });

  it('keeps an unnamed template and an unnamed example as orphans, and drops the finding once a live document names them', async () => {
    const files = {
      ...live,
      '.claude/forms/page-form.md': '# Page\n\nClient: {{client}}\nOwner: <owner>\n',
      '.claude/samples/page.md': '# Example\n\nA finished page.\n',
    };
    const root = await estate(files);
    const { map, raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    expect(
      lintEstate(map, raw)
        .findings.filter((finding) => finding.code === 'ORPHAN')
        .map((finding) => finding.subject)
        .sort(),
    ).toEqual(['.claude/forms/page-form.md', '.claude/samples/page.md']);
    const named = await estate({
      ...files,
      'CLAUDE.md':
        '# Rules\nRead `.claude/skills/editor/SKILL.md`.\nRead `.claude/forms/page-form.md` before filling a page.\nRead `.claude/samples/page.md`.\n',
    });
    const again = await scanEstate({
      root: named,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    expect(lintEstate(again.map, again.raw).findings.filter((finding) => finding.code === 'ORPHAN')).toEqual(
      [],
    );
  });

  it('keeps a helper definition unreachable when its own body reads like a record or a form', async () => {
    const root = await estate({
      ...live,
      '.claude/agents/intake.md':
        '---\nname: intake\ndescription: Takes requests.\n---\nClient: {{client}}\nOwner: <owner>\nTopic: {{topic}}\n',
      '.claude/agents/ledger.md':
        '---\nname: ledger\ndescription: Keeps books.\n---\n# Entries\n\n## 2025-01-01\nOpened.\n\n## 2025-01-02\nClosed.\n',
    });
    const { map, raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    const roles = new Map(map.documents?.map((document) => [document.path, document.role]));
    expect(roles.get('.claude/agents/intake.md')).toBe('template');
    expect(roles.get('.claude/agents/ledger.md')).toBe('history');
    expect(
      lintEstate(map, raw)
        .findings.filter((finding) => finding.code === 'UNREACHABLE')
        .map((finding) => finding.subject)
        .sort(),
    ).toEqual(['.claude/agents/intake.md', '.claude/agents/ledger.md']);
  });

  it('keeps the scripts of an unrouted live skill findings even inside a folder whose name implies a role', async () => {
    const root = await estate({
      ...live,
      '.claude/skills/beta/SKILL.md':
        '---\nname: beta\ndescription: Unrouted.\n---\n# Beta\nNothing routes here.\n',
      '.claude/skills/beta/scripts/run.py': 'print("run")\n',
      '.claude/skills/beta/scripts/examples/sample.py': 'print("sample")\n',
      '.claude/skills/beta/scripts/fixtures/input.py': 'print("input")\n',
    });
    const { map, raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    expect(
      lintEstate(map, raw)
        .findings.filter((finding) => finding.code === 'UNREACHABLE')
        .map((finding) => finding.subject)
        .sort(),
    ).toEqual([
      '.claude/skills/beta/SKILL.md',
      '.claude/skills/beta/scripts/examples/sample.py',
      '.claude/skills/beta/scripts/fixtures/input.py',
      '.claude/skills/beta/scripts/run.py',
    ]);
  });

  it('counts a file a navigation document points at as named, without making it reachable or creating atoms', async () => {
    const root = await estate({
      ...live,
      '.claude/changes.md':
        '# Engineering notes\n\n## 2025-02-01\nRead `.claude/tools/legacy.md` again.\n\n## 2025-01-01\nRead `.claude/tools/absent.md`.\n',
      '.claude/tools/legacy.md': '# Legacy\nBody.\n',
    });
    const { map, raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    expect(map.documents?.find((document) => document.path === '.claude/changes.md')?.role).toBe('history');
    expect(map.atoms.filter((atom) => atom.provenance.file === '.claude/changes.md')).toEqual([]);
    const result = lintEstate(map, raw);
    expect(result.findings.filter((finding) => finding.code === 'ORPHAN').map((f) => f.subject)).toEqual([]);
    expect(result.findings.filter((finding) => finding.code === 'UNREACHABLE').map((f) => f.subject)).toEqual(
      ['.claude/tools/legacy.md'],
    );
    expect(result.counts.MISSING_REFERENCE).toBe(0);
  });
});
