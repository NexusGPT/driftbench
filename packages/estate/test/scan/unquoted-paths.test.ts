import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const skill = '.claude/skills/ship/SKILL.md';
const body = '---\nname: ship\ndescription: Ship an order.\n---\n';
describe('unquoted relative file paths', () => {
  it.each([
    'references/guide.md',
    '**references/guide.md**',
    '@references/guide.md',
    '<references/guide.md>',
  ])('reads %s', async (token) => {
    const root = await estate({
      [skill]: `${body}Read ${token} before shipping.`,
      '.claude/skills/ship/references/guide.md': '# Guide',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'reference')).toMatchObject([
      { fields: { path: '.claude/skills/ship/references/guide.md' } },
    ]);
  });
  it.each([
    'Read https://example.org/references/guide.md.',
    'Run `cat references/guide.md`.',
    'Run cat references/guide.md.',
    'Read [references/title.md](references/guide.md).',
    'Read [references/title.md [nested]](references/guide.md).',
    'Read [references/title.md \\] escaped](references/guide.md).',
  ])('preserves exclusions for %s', async (line) => {
    const root = await estate({
      [skill]: `${body}${line}`,
      '.claude/skills/ship/references/guide.md': '# Guide',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'reference').map((a) => a.fields?.path)).toEqual(
      line.startsWith('Read [') ? ['.claude/skills/ship/references/guide.md'] : [],
    );
  });
});
