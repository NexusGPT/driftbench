import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const helper = (name: string) => `---\nname: ${name}\ndescription: Checks records.\n---\n\nYou read.\n`;

async function dispatched(body: string) {
  const root = await estate({
    'CLAUDE.md': '# Rules\n',
    '.claude/agents/desk-clerk-9.md': helper('desk-clerk-9'),
    '.claude/agents/desk-clerk-90.md': helper('desk-clerk-90'),
    '.claude/skills/plan/SKILL.md': `---\nname: plan\ndescription: Plans.\n---\n\n${body}\n`,
  });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  const name = new Map(map.atoms.map((atom) => [atom.id, String(atom.fields?.name)]));
  return map.edges.filter((edge) => edge.kind === 'dispatch').map((edge) => name.get(edge.to));
}

describe('a helper dispatched by its plain name', () => {
  it('reads "the X agent" and "X helper" without backticks', async () => {
    expect(await dispatched('Dispatch the desk-clerk-9 agent to check the records.')).toEqual([
      'desk-clerk-9',
    ]);
    expect(await dispatched('Hand the count to desk-clerk-90.')).toEqual(['desk-clerk-90']);
  });

  it('does not read a name inside a longer name, or a negated dispatch', async () => {
    expect(await dispatched('The desk-clerk-9x tool is not a helper.')).toEqual([]);
    expect(await dispatched('Never dispatch the desk-clerk-9 agent for this.')).toEqual([]);
  });
});
