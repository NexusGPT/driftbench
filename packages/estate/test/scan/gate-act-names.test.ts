import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

describe('gate act tool names', () => {
  it.each([
    ['updating an invoice', 'Edit'],
    ['update an invoice', 'Edit'],
    ['renaming a report file', 'Bash'],
    ['rename a report file', 'Bash'],
    ['modifying a report', 'Edit'],
    ['deploying a report service', 'Bash'],
    ['delegating a report review', 'Agent'],
    ['editing an invoice', 'Edit'],
    ['running the test', 'Bash'],
  ])('maps %s to %s', async (act, tool) => {
    const root = await estate({
      'CLAUDE.md': `Before ${act}: read \`guide.md\`.`,
      'guide.md': '# Guide\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const gates = map.atoms.filter((a) => a.kind === 'gate');
    expect(gates).toHaveLength(1);
    expect(gates[0]?.evidence).toContainEqual({ type: 'ordered', before: 'Read', after: tool });
  });
});
