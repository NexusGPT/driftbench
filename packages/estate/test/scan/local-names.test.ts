import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, locateNamed, scanEstate } from '../../src/index';
import type { EstateFile } from '../../src/scan/reader';
import { estate, NOW, structurePointer } from '../support';

const FROM = '.claude/skills/reconcile/SKILL.md';
const files = (...paths: string[]) =>
  new Map(paths.map((path) => [path, { path, kind: 'other', text: '' } satisfies EstateFile]));

describe('bare names use the documented local search order', () => {
  it('chooses a descendant of its own folder before a file at the root or in another skill', () => {
    expect(
      locateNamed(
        'guide.md',
        FROM,
        files('.claude/skills/reconcile/references/guide.md', 'guide.md', '.claude/skills/shipping/guide.md'),
      ).path,
    ).toBe('.claude/skills/reconcile/references/guide.md');
  });

  it('chooses the only deeper descendant before global names, regardless of file insertion order', () => {
    const paths = [
      '.claude/skills/shipping/references/guide.md',
      '.claude/skills/reconcile/references/deep/guide.md',
    ];
    for (const order of [paths, [...paths].reverse()]) {
      expect(locateNamed('guide.md', FROM, files(...order))).toMatchObject({
        path: '.claude/skills/reconcile/references/deep/guide.md',
        via: 'suffix',
      });
    }
  });

  it('chooses the exact naming folder first, then the root when its subtree has no match', () => {
    const paths = [
      'guide.md',
      '.claude/skills/reconcile/guide.md',
      '.claude/skills/reconcile/references/guide.md',
    ];
    expect(locateNamed('guide.md', FROM, files(...paths))).toEqual({
      path: '.claude/skills/reconcile/guide.md',
      via: 'place',
    });
    expect(locateNamed('guide.md', FROM, files('guide.md', '.claude/skills/shipping/guide.md'))).toEqual({
      path: 'guide.md',
      via: 'place',
    });
  });

  it('keeps ambiguity inside the first matching scope, excluding unrelated global files', () => {
    expect(
      locateNamed(
        'guide.md',
        FROM,
        files(
          '.claude/skills/shipping/guide.md',
          '.claude/skills/reconcile/b/guide.md',
          '.claude/skills/reconcile/a/guide.md',
          'guide.md',
        ),
      ),
    ).toEqual({
      path: '.claude/skills/reconcile/guide.md',
      via: 'none',
      candidates: ['.claude/skills/reconcile/a/guide.md', '.claude/skills/reconcile/b/guide.md'],
    });
  });
  it('reads a named root reference and includes it in an estate copy, without loading unrelated root files', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      [FROM]: '---\nname: reconcile\ndescription: Reconcile an invoice.\n---\n\nRead `guide.md` first.\n',
      'guide.md': '# Root guide\n',
      'unused.md': '# Not part of the estate\n',
      '.claude/skills/shipping/references/guide.md': '# Shipping guide\n',
    });
    const reader = new ClaudeCodeReader();
    const { map, raw } = await scanEstate({ root, reader, now: NOW, pointer: structurePointer() });
    const reference = map.atoms.find((atom) => atom.kind === 'reference' && atom.provenance.file === FROM);
    expect(reference?.fields).toMatchObject({ path: 'guide.md', exists: true });
    expect(raw.files.map((file) => file.path)).toContain('guide.md');
    expect(raw.files.map((file) => file.path)).not.toContain('unused.md');
    expect(await reader.listFiles(root)).toContain('guide.md');
  });
  it('keeps a root file outside the estate when a local guide wins', async () => {
    const root = await estate({
      [FROM]: '---\nname: reconcile\ndescription: Reconcile an invoice.\n---\nRead `guide.md`.\n',
      '.claude/skills/reconcile/references/guide.md': '# Local guide\n',
      'guide.md': '# Unused root guide\n',
    });
    const reader = new ClaudeCodeReader();
    const raw = await reader.read(root);
    expect(raw.files.map((file) => file.path)).not.toContain('guide.md');
    expect(await reader.listFiles(root)).not.toContain('guide.md');
  });

  it('honors root ignore and size limits, and follows a finite chain of named root guides', async () => {
    const root = await estate({
      [FROM]:
        '---\nname: reconcile\ndescription: Reconcile an invoice.\n---\nRead `guide.md`, `secret.md` and `large.md`.\n',
      'driftbench.estate.yaml': 'ignore: [secret.md]\n',
      'secret.md': '# Secret\n',
      'large.md': 'x'.repeat(1024 * 1024 + 1),
      'guide.md': '# Guide\nRead `next.md`.\n',
      'next.md': '# Next\nRead `guide.md`.\n',
      'unused.md': '# Unused\n',
    });
    const reader = new ClaudeCodeReader();
    const raw = await reader.read(root);
    expect(raw.files.map((file) => file.path)).toEqual(expect.arrayContaining(['guide.md', 'next.md']));
    expect(raw.files.map((file) => file.path)).not.toEqual(expect.arrayContaining(['secret.md', 'large.md']));
    expect(raw.ignored?.paths).toContain('secret.md');
    expect(raw.notes).toContainEqual({ file: 'large.md', message: 'skipped: larger than 1 MB' });
    const copy = await reader.listFiles(root);
    expect(copy).toContain('large.md');
    expect(copy).not.toContain('secret.md');
    expect(copy).not.toContain('unused.md');
  });
  it('does not load an unrelated root guide when the reference resolves to an explicitly skipped local file', async () => {
    const root = await estate({
      [FROM]: '---\nname: reconcile\ndescription: Reconcile an invoice.\n---\nRead `guide.md`.\n',
      '.claude/skills/reconcile/guide.md': '# Local\n',
      'guide.md': '# Unused root\n',
      'driftbench.estate.yaml': 'ignore: [/.claude/skills/reconcile/guide.md]\n',
    });
    const { map, raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    expect(map.atoms.find((atom) => atom.kind === 'reference')?.fields).toMatchObject({
      path: '.claude/skills/reconcile/guide.md',
      ignored: true,
    });
    expect(raw.files.map((file) => file.path)).not.toContain('guide.md');
  });
});
