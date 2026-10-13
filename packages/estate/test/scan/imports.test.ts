import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, namedPaths, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

describe('files the standing instructions import with @', () => {
  it('reads an imported file, and a file it imports, as standing prose', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n\n@.claude/docs/rules.md\nSee also @docs-extra.md for the team.\n',
      '.claude/docs/rules.md': '# Imported\n\n@more.md\nAlways keep the totals in whole cents.\n',
      '.claude/docs/more.md': '# More\n\nNever round twice.\n',
      'docs-extra.md': '# Extra\n\nAlways sign the log.\n',
      '.claude/docs/stray.md': '# Stray\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect([...new Set(raw.prose.map((chunk) => chunk.file))].sort()).toEqual([
      '.claude/docs/more.md',
      '.claude/docs/rules.md',
      'CLAUDE.md',
      'docs-extra.md',
    ]);
    expect(
      raw.files
        .filter((file) => file.kind === 'standing')
        .map((file) => file.path)
        .sort(),
    ).toEqual(['.claude/docs/more.md', '.claude/docs/rules.md', 'CLAUDE.md', 'docs-extra.md']);
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'reference')).toEqual([]);
  });

  it('keeps an @path in a skill body a file to read, and an e-mail address no path', async () => {
    expect(namedPaths('Mail ana@example.com or read `notes.md`.')).toEqual(['notes.md']);
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/a/SKILL.md':
        '---\nname: a\ndescription: Does a.\n---\n\nRead @references/guide.md first.\n',
      '.claude/skills/a/references/guide.md': '# Guide\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'reference').map((atom) => atom.fields?.path)).toEqual([
      '.claude/skills/a/references/guide.md',
    ]);
  });
});
