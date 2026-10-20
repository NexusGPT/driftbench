import { describe, expect, it } from 'vitest';
import { classifyDocument, normativeRanges } from '../../src/scan/document-roles';

describe('document authority boundaries', () => {
  it.each([
    ['.claude/archive-policy.md', '# Archive policy\n\nRead `live.md` before editing a page.\n'],
    ['.claude/history.md', '# History API\n\n2025-01-01: Read `live.md` before editing a page.\n'],
    [
      '.claude/templates-integration.md',
      '# Generating pages\n\nRead `<slug>/guide.md`.\nRead `{{folder}}/rules.md`.\n',
    ],
    [
      '.claude/guide.md',
      '# Editing\n\nRead `live.md`.\n\n## 2025-01-01\nA historical entry.\n\n## 2025-01-02\nAnother entry.\n',
    ],
  ])('does not suppress the live procedure %s', (path, text) => {
    expect(classifyDocument({ path, text }).role).toBe('normative');
    expect(normativeRanges({ path, text, kind: 'other' }, 1, text.split('\n').length)).not.toEqual([]);
  });

  it('keeps the real clause after a semicolon following an illustrative quotation', () => {
    const text = 'Example: "process restart"; after a compaction, reload the saved state.\n';
    expect(classifyDocument({ path: 'CLAUDE.md', text }).sections).toBeUndefined();
  });

  it('opens no section on a heading word: a live part shown as an example is labelled by the reader, not by code', () => {
    const text =
      '# Rules\nRead `first.md`.\n## Examples\nRead `example.md`.\n### More examples\nRead `another.md`.\n## Live rules\nRead `last.md`.\n';
    const info = classifyDocument({ path: 'CLAUDE.md', text });
    expect(info.sections).toBeUndefined();
    expect(normativeRanges({ path: 'CLAUDE.md', text, kind: 'standing' }, 1, 8)).toEqual([
      { startLine: 1, endLine: 8 },
    ]);
  });
});

it('bounds a counter-example a lone cross mark opens, without swallowing the next live paragraph', () => {
  const text =
    '# Rules\n\n✗\n\n> Read `fictional.md` before editing a page.\n> After a compaction, reload the example.\n\nRead `live.md` before editing a page.\n';
  expect(classifyDocument({ path: 'CLAUDE.md', text }).sections).toEqual([
    { startLine: 3, endLine: 6, role: 'example' },
  ]);
  // The words that introduced an example before ("e.g.") open nothing now.
  expect(classifyDocument({ path: 'CLAUDE.md', text: text.replace('✗', 'e.g.') }).sections).toBeUndefined();
});

it('ends a fenced counter-example at its closing fence, including blank lines inside', () => {
  const text =
    '# Rules\n✘\n\n```md\nRead `fictional.md`.\n\nAfter a compaction, reload.\n```\nRead `live.md` before editing a page.\n';
  expect(classifyDocument({ path: 'CLAUDE.md', text }).sections).toEqual([
    { startLine: 2, endLine: 8, role: 'example' },
  ]);
});

it('does not let embedded dated entries erase the operational section, nor make a section of them by a word', () => {
  const text =
    '# Rules\n\nRead `live.md` before editing a page.\n\n## History\nAppend-only log.\n\n- 2024-01-01: Read `old.md`.\n- 2024-01-02: Read `older.md`.\n';
  const info = classifyDocument({ path: 'CLAUDE.md', text });
  expect(info.role).toBe('normative');
  expect(info.sections).toBeUndefined();
});

it('recognizes date-bearing entry headings even when a date follows an entry label', () => {
  const text =
    '# Engineering notebook\n\n## Session [2025-1-2]\nAfter a compaction, read `old.md`.\n\n## Session [2025-1-3]\nRead `older.md`.\n';
  expect(classifyDocument({ path: '.claude/notebook.md', text }).role).toBe('history');
});
