import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const helper = (name: string) =>
  `---\nname: ${name}\ndescription: Checks records.\ntools: Read\n---\n\nYou read.\n`;
const skill = (name: string) => `---\nname: ${name}\ndescription: Checks things.\n---\n\nBody.\n`;

describe('helpers in subfolders and units that share a name', () => {
  it('reads a helper in a subfolder of the helpers folder', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/agents/team/clerk.md': helper('clerk'),
      '.claude/agents/team/deep/scout.md': helper('scout'),
      '.claude/agents/team/notes.txt': 'not a helper\n',
    });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(raw.subagents.map((unit) => [unit.name, unit.file])).toEqual([
      ['clerk', '.claude/agents/team/clerk.md'],
      ['scout', '.claude/agents/team/deep/scout.md'],
    ]);
    expect(map.atoms.filter((atom) => atom.kind === 'route').map((atom) => atom.fields?.target)).toEqual([
      'clerk',
      'scout',
    ]);
  });

  it('reads both skills that declare one name and notes the shared name on the later file', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/plan-a/SKILL.md': skill('plan'),
      '.claude/skills/plan-b/SKILL.md': skill('plan'),
      '.claude/skills/other/SKILL.md': skill('other'),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.skills.map((unit) => unit.name)).toEqual(['other', 'plan', 'plan']);
    expect(raw.notes).toEqual([
      {
        file: '.claude/skills/plan-b/SKILL.md',
        message:
          'the skill name plan is also declared by .claude/skills/plan-a/SKILL.md: the runtime loads one of them',
      },
    ]);
  });

  it('notes two helpers that declare one name, and not a skill and a helper that do', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/agents/clerk.md': helper('clerk'),
      '.claude/agents/team/clerk.md': helper('clerk'),
      '.claude/skills/clerk/SKILL.md': skill('clerk'),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.notes).toEqual([
      {
        file: '.claude/agents/team/clerk.md',
        message:
          'the helper name clerk is also declared by .claude/agents/clerk.md: the runtime loads one of them',
      },
    ]);
  });
});
