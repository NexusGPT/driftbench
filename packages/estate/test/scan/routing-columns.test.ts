import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const skills = {
  '.claude/skills/ship/SKILL.md': '---\nname: ship\ndescription: Ship an order.\n---\n',
  '.claude/skills/count/SKILL.md': '---\nname: count\ndescription: Count stock.\n---\n',
};

async function routes(table: string) {
  const root = await estate({ ...skills, 'CLAUDE.md': `# Rules\n\n${table}\n` });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return map.atoms
    .filter((atom) => atom.kind === 'route' && atom.fields?.via === 'table')
    .map((atom) => [atom.provenance.startLine, atom.fields?.target, atom.fields?.ask]);
}

describe('the columns of a routing table', () => {
  it('reads a table whose first column names the skill and whose second holds the ask', async () => {
    expect(
      await routes(
        '| Skill | Use when the user wants to |\n|---|---|\n| `ship` | send an order |\n| count | count the stock |',
      ),
    ).toEqual([
      [5, 'ship', 'send an order'],
      [6, 'count', 'count the stock'],
    ]);
  });

  it('reads no route from a table of owners', async () => {
    expect(await routes('| Owner | Skill they maintain |\n|---|---|\n| Ana | `ship` |')).toEqual([]);
    expect(await routes('| Maintainers | Skills |\n|---|---|\n| Ana | `ship` |')).toEqual([]);
  });

  it('keeps the ask in the first column when no header names it', async () => {
    expect(await routes('| Task | Skill |\n|---|---|\n| send an order | `ship` |')).toEqual([
      [5, 'ship', 'send an order'],
    ]);
    expect(await routes('| Goal | Load |\n|---|---|\n| send an order | `ship` |')).toEqual([
      [5, 'ship', 'send an order'],
    ]);
  });
});
