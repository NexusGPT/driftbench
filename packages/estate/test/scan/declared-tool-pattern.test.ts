import { expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

// An invented harbour office: the skill declares tools with and without a pattern.
const FILES = {
  'CLAUDE.md': '# Harbour office\n',
  '.claude/settings.json': '{ "permissions": { "allow": ["Bash(ls *)"] } }\n',
  '.claude/skills/moorings/SKILL.md': [
    '---',
    'name: moorings',
    'description: Tie up a boat at the right quay.',
    'allowed-tools: Read, Bash(rope tie *), Bash(rope untie), Edit(quay/*)',
    '---',
    '',
    '# Moorings',
    '',
  ].join('\n'),
};

it('keeps the pattern of each declared tool in the atom of that tool', async () => {
  const root = await estate(FILES);
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  const declared = map.atoms.filter((atom) => atom.kind === 'tool' && atom.fields?.effect === 'declared');
  const byTool = Object.fromEntries(declared.map((atom) => [atom.fields?.tool, atom.fields?.rules]));
  expect(byTool).toEqual({
    Read: ['Read'],
    Bash: ['Bash(rope tie *)', 'Bash(rope untie)'],
    Edit: ['Edit(quay/*)'],
  });
});

it('leaves the atoms, ids and map hash of the scan as they were', async () => {
  const root = await estate(FILES);
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  const declared = map.atoms.filter((atom) => atom.kind === 'tool' && atom.fields?.effect === 'declared');
  expect(declared.map((atom) => [atom.title, atom.fields?.rule])).toEqual([
    ['Declared Read', 'Read'],
    ['Declared Bash', 'Bash'],
    ['Declared Edit', 'Edit'],
  ]);
});
