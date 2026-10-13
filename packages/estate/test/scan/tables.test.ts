import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, DEFAULT_CHUNK_CHARACTERS, readTables, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

/** A routing table longer than one prose chunk: every row is a route, whichever chunk its line falls in. */
describe('a routing table longer than one prose chunk', () => {
  const ROWS = 400;
  const skill = (name: string) =>
    `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\nDo the ${name} work.\n`;
  const table = [
    '| When the user wants to | Load |',
    '|---|---|',
    ...Array.from(
      { length: ROWS },
      (_, index) =>
        `| handle request number ${String(index + 1).padStart(3, '0')} of the long routing table here | \`${index % 2 === 0 ? 'alpha' : 'beta'}\` |`,
    ),
  ];

  it('is longer than a chunk in this test', () => {
    expect(table.join('\n').length).toBeGreaterThan(DEFAULT_CHUNK_CHARACTERS);
  });

  it('gives a route for every row, none lost past the end of the chunk that holds the header', async () => {
    const root = await estate({
      'CLAUDE.md': ['# Routing', '', ...table, '', 'Always answer in the user language.', ''].join('\n'),
      '.claude/skills/alpha/SKILL.md': skill('alpha'),
      '.claude/skills/beta/SKILL.md': skill('beta'),
    });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(raw.prose.filter((chunk) => chunk.file === 'CLAUDE.md').length).toBeGreaterThan(1);
    const routes = map.atoms.filter((atom) => atom.kind === 'route' && atom.fields?.via === 'table');
    expect(routes).toHaveLength(ROWS);
    expect(new Set(routes.map((atom) => atom.provenance.startLine)).size).toBe(ROWS);
  });

  it('reads a table whose header is in the range to its last row, and none whose header is before it', () => {
    const text = ['| a | b |', '|---|---|', '| 1 | x |', '| 2 | y |', '| 3 | z |', '', 'after'].join('\n');
    expect(readTables(text, 1, 3).map((found) => found.rows.length)).toEqual([3]);
    expect(readTables(text, 4, 7)).toEqual([]);
  });
});
