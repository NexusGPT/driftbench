import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, readTables, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

describe('optional markdown table borders', () => {
  it.each([
    ['no borders', 'When | Load\n--- | ---\ncheck a parcel | tally'],
    ['trailing border', 'When | Load |\n--- | --- |\ncheck a parcel | tally |'],
    ['leading border', '| When | Load\n| --- | ---\n| check a parcel | tally'],
    ['mixed borders', '| When | Load |\n--- | ---\ncheck a parcel | tally'],
  ])('reads %s with the original row and line', (_name, table) => {
    expect(readTables(`# Routing\n\n${table}\n\nFollowing paragraph.`)).toEqual([
      {
        header: ['When', 'Load'],
        headerLine: 3,
        rows: [{ line: 5, text: table.split('\n')[2], cells: ['check a parcel', 'tally'] }],
      },
    ]);
  });

  it('requires a complete delimiter row matching the header width', () => {
    expect(readTables('When | Load\n--- | prose\ncheck a parcel | tally')).toEqual([]);
    expect(readTables('When | Load\n--- | --- | ---\ncheck a parcel | tally')).toEqual([]);
    expect(readTables('A heading\n---\nFollowing paragraph')).toEqual([]);
  });

  it('keeps alignment markers and ignores fenced examples', () => {
    const table = 'When | Load\n:--- | ---:\ncheck a parcel | tally';
    expect(readTables(table)[0]?.rows[0]?.cells).toEqual(['check a parcel', 'tally']);
    expect(readTables(`\`\`\`text\n${table}\n\`\`\``)).toEqual([]);
  });

  it('builds a route from a borderless standing table', async () => {
    const root = await estate({
      'CLAUDE.md': 'When | Load\n--- | ---\ncheck a parcel | `tally`\n',
      '.claude/skills/tally/SKILL.md': '---\nname: tally\ndescription: Count parcels.\n---\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'route' && atom.fields?.via === 'table')).toMatchObject([
      { fields: { target: 'tally', ask: 'check a parcel' }, provenance: { startLine: 3 } },
    ]);
  });

  it('reads a borderless guard registry through the same table parser', async () => {
    const root = await estate({
      'CLAUDE.md': '# Instructions\n',
      '.claude/CHECK-REGISTRY.md': 'Guard | Enforces\n--- | ---\nparcel.sh | R1\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.registry).toMatchObject([{ guard: 'parcel.sh', enforces: [{ id: 'R1' }] }]);
  });
});
