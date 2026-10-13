import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

async function references(body: string[]) {
  const root = await estate({
    'CLAUDE.md': '# Rules\n',
    '.claude/skills/a/references/guide.md': '# Guide\n',
    '.claude/skills/a/SKILL.md': ['---', 'name: a', 'description: Does a.', '---', '', ...body, ''].join(
      '\n',
    ),
  });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return map.atoms
    .filter((atom) => atom.kind === 'reference')
    .map((atom) => [atom.provenance.startLine, atom.fields?.path]);
}

describe('files named in change notes', () => {
  it('reads no reference in a section of changes, and reads one after it', async () => {
    expect(
      await references([
        'Open `references/guide.md` when unsure.',
        '## Changes',
        '',
        '- Version 2 removed `references/legacy.md`.',
        '- Version 3 added `references/guide.md`.',
        '## Steps',
        '',
        'Open `references/guide.md` before the count.',
      ]),
    ).toEqual([
      [6, '.claude/skills/a/references/guide.md'],
      [13, '.claude/skills/a/references/guide.md'],
    ]);
  });

  it('reads no reference in a line saying a file was removed, renamed or replaced', async () => {
    expect(
      await references([
        '`references/old.md` was removed in May.',
        'We deleted `references/draft.md` last week.',
        'The file `references/v1.md` was renamed to `references/guide.md`.',
      ]),
    ).toEqual([]);
  });
});
