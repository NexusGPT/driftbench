import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

describe('a reference that names another reference', () => {
  it('gives the skill a reference edge to the file its own reference names', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/a/SKILL.md':
        '---\nname: a\ndescription: Does a.\n---\n\nOpen `references/notes.md` first.\n',
      '.claude/skills/a/references/notes.md': '# Notes\nWhen the case is unusual, open `more.md` as well.\n',
      '.claude/skills/a/references/more.md': '# More\n',
      '.claude/docs/policy.md': '# Policy\nOpen `.claude/skills/a/references/more.md` too.\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const atom = new Map(map.atoms.map((entry) => [entry.id, entry]));
    const edges = map.edges
      .filter((edge) => edge.kind === 'reference')
      .map((edge) => [atom.get(edge.from)?.fields?.name, atom.get(edge.to)?.fields?.path]);
    expect(edges).toEqual([
      ['a', '.claude/skills/a/references/more.md'],
      ['a', '.claude/skills/a/references/notes.md'],
    ]);
  });
});
