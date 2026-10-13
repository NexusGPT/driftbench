import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const units = {
  '.claude/skills/ship-plan/SKILL.md': '---\nname: ship-plan\ndescription: Plan a delivery.\n---\n',
  '.claude/agents/desk-clerk.md': '---\nname: desk-clerk\ndescription: Checks records.\n---\n',
};

async function routes(lines: string[]) {
  const root = await estate({ ...units, 'CLAUDE.md': ['# Rules', '', ...lines, ''].join('\n') });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return map.atoms
    .filter((atom) => atom.kind === 'route' && atom.fields?.via !== 'description')
    .map((atom) => [
      atom.provenance.startLine,
      atom.fields?.target,
      atom.fields?.targetKind,
      atom.fields?.ask,
    ]);
}

describe('routing written in prose', () => {
  it('reads a list item and a sentence that load a skill or dispatch a helper', async () => {
    expect(
      await routes([
        '- To plan a delivery: load `ship-plan`.',
        'When the user wants to plan a delivery, load the `ship-plan` skill.',
        'If the user asks to check the records, dispatch the `desk-clerk` agent.',
      ]),
    ).toEqual([
      [3, 'ship-plan', 'skill', 'plan a delivery'],
      [4, 'ship-plan', 'skill', 'plan a delivery'],
      [5, 'desk-clerk', 'subagent', 'check the records'],
    ]);
  });

  it('reads a heading per skill with the ask on the next line', async () => {
    expect(
      await routes([
        '## Skills',
        '',
        '### `ship-plan`',
        '',
        'Use it when the user wants to plan a delivery.',
      ]),
    ).toEqual([[5, 'ship-plan', 'skill', 'plan a delivery']]);
  });

  it('reads no route from a negated, unknown or passing mention', async () => {
    expect(
      await routes([
        'To chat about the weather, never load `ship-plan`.',
        'To plan a party: load `party-plan`.',
        'The `ship-plan` skill was written last year.',
        '### Notes',
      ]),
    ).toEqual([]);
  });
});
