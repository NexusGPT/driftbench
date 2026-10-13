import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const skills = {
  '.claude/skills/ship/SKILL.md': '---\nname: ship\ndescription: Ship an order.\n---\n',
  '.claude/agents/auditor.md': '---\nname: auditor\ndescription: Audit an invoice.\n---\n',
};

async function rows(table: string) {
  const root = await estate({ ...skills, 'CLAUDE.md': `# Rules\n\n${table}\n` });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return {
    routes: map.atoms
      .filter((atom) => atom.kind === 'route' && atom.fields?.via === 'table')
      .map((atom) => [atom.provenance.startLine, atom.fields?.target, atom.fields?.ask]),
    references: map.atoms.filter((atom) => atom.kind === 'reference').map((atom) => atom.fields?.path),
  };
}

describe('the forms a routing cell names its target in', () => {
  it('reads a link to the skill file as a route, not a reference', async () => {
    expect(
      await rows('| When | Load |\n|---|---|\n| send an order | [ship](.claude/skills/ship/SKILL.md) |'),
    ).toEqual({
      routes: [[5, 'ship', 'send an order']],
      references: [],
    });
  });

  it('reads a link to a helper file as a route to the helper', async () => {
    expect(
      await rows('| When | Use |\n|---|---|\n| audit | [the auditor](.claude/agents/auditor.md) |'),
    ).toEqual({
      routes: [[5, 'auditor', 'audit']],
      references: [],
    });
  });

  it('reads a slash command as the skill it runs', async () => {
    expect((await rows('| When | Load |\n|---|---|\n| send an order | `/ship` |')).routes).toEqual([
      [5, 'ship', 'send an order'],
    ]);
  });

  it('still reads a link to another file in a table as a reference', async () => {
    const root = await estate({
      ...skills,
      'notes.md': '# Notes\n',
      'CLAUDE.md': '# Rules\n\n| When | Read |\n|---|---|\n| unsure | [the notes](notes.md) |\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'reference').map((atom) => atom.fields?.path)).toEqual([
      'notes.md',
    ]);
  });
});
