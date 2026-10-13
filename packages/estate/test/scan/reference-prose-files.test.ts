import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate } from '../support';

async function proseFiles(files: Record<string, string>) {
  const root = await estate({ 'CLAUDE.md': '# Rules\n', ...files });
  const raw = await new ClaudeCodeReader().read(root);
  return [...new Set(raw.prose.map((chunk) => chunk.file))].sort();
}

describe('the prose of the files the estate names', () => {
  it('reads a plain text file beside a skill as prose, and not a data file', async () => {
    expect(
      await proseFiles({
        '.claude/skills/a/SKILL.md':
          '---\nname: a\ndescription: Does a.\n---\n\nOpen `references/notes.txt` first.\n',
        '.claude/skills/a/references/notes.txt': 'NOTES\nNever audit a route twice.\n',
        '.claude/skills/a/references/codes.json': '{ "codes": ["A"] }\n',
      }),
    ).toEqual(['.claude/skills/a/SKILL.md', '.claude/skills/a/references/notes.txt', 'CLAUDE.md']);
  });

  it('reads a document outside any skill that the standing file names, and its own named document', async () => {
    expect(
      await proseFiles({
        'CLAUDE.md': '# Rules\n\nWhen a policy question comes up, read `.claude/docs/policy.md`.\n',
        '.claude/docs/policy.md': '# Policy\nFor refunds, open `refunds.md`.\n',
        '.claude/docs/refunds.md': '# Refunds\nNever refund twice.\n',
        '.claude/docs/unnamed.md': '# Stray\nNever do this.\n',
      }),
    ).toEqual(['.claude/docs/policy.md', '.claude/docs/refunds.md', 'CLAUDE.md']);
  });
});

describe('an alias table the prose names', () => {
  it('stays configuration, not prose', async () => {
    expect(
      await proseFiles({
        'CLAUDE.md': '# Rules\n\nRead `.claude/ALIASES.md` for the short names.\n',
        '.claude/ALIASES.md': '| Alias | Folder |\n|---|---|\n| REF | .claude/docs |\n',
      }),
    ).toEqual(['CLAUDE.md']);
  });
});
