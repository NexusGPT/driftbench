import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, namedPaths, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

describe('paths written in other forms', () => {
  it('reads backslashes, a line number, the project folder variable and a wiki link', () => {
    expect(namedPaths('When unsure, open `references\\guide.md`.')).toEqual(['references/guide.md']);
    expect(namedPaths('When unsure, open `references/guide.md:12`.')).toEqual(['references/guide.md']);
    expect(namedPaths('See references/guide.md:12:4 for the limits.')).toEqual(['references/guide.md']);
    expect(namedPaths('Open `$CLAUDE_PROJECT_DIR/.claude/skills/a/guide.md`.')).toEqual([
      '.claude/skills/a/guide.md',
    ]);
    expect(namedPaths('Open `${CLAUDE_PROJECT_DIR}/notes.md`.')).toEqual(['notes.md']);
    expect(namedPaths('When unsure, see [[references/guide]].')).toEqual(['references/guide.md']);
    expect(namedPaths('See [[references/guide|the guide]] and [[notes.txt]].')).toEqual([
      'references/guide.md',
      'notes.txt',
    ]);
  });

  it('still drops a variable it does not know and a glob', () => {
    expect(namedPaths('Open `$HOME/notes.md` or `references/*.md`.')).toEqual([]);
  });

  it('turns each form into a reference to the skill file', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/a/references/guide.md': '# Guide\n',
      '.claude/skills/a/SKILL.md': [
        '---',
        'name: a',
        'description: Does a.',
        '---',
        '',
        'When unsure, open `references\\guide.md`.',
        'When unsure, open `references/guide.md:12`.',
        'When unsure, open `$CLAUDE_PROJECT_DIR/.claude/skills/a/references/guide.md`.',
        'When unsure, see [[references/guide]].',
        '',
      ].join('\n'),
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const references = map.atoms.filter((atom) => atom.kind === 'reference');
    expect(
      references.map((atom) => [atom.provenance.startLine, atom.fields?.path, atom.fields?.exists]),
    ).toEqual([
      [6, '.claude/skills/a/references/guide.md', true],
      [7, '.claude/skills/a/references/guide.md', true],
      [8, '.claude/skills/a/references/guide.md', true],
      [9, '.claude/skills/a/references/guide.md', true],
    ]);
  });
});
