import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, INFORMATION, lintEstate, scanEstate } from '../src/index';
import { estate, NOW } from './support';

const SKILL = (name: string) =>
  `---\nname: ${name}\ndescription: Keeps the ${name} notes.\n---\n\nKeep the notes short.\n`;

async function lint(settings: Record<string, unknown>) {
  const root = await estate({
    'CLAUDE.md': '# Synthetic estate\n\nFor notes, load `notes-keeper`.\n',
    '.claude/skills/notes-keeper/SKILL.md': SKILL('notes-keeper'),
    '.claude/agents/note-reader.md':
      '---\nname: note-reader\ndescription: Reads one note.\ntools: Read\n---\n\nRead.\n',
    '.claude/settings.json': JSON.stringify(settings),
  });
  const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return lintEstate(map, raw).findings.filter((finding) => finding.code.startsWith('PERMISSION_'));
}

describe('permission checks', () => {
  it('flags a Skill rule that names no skill, in each argument form', async () => {
    const found = await lint({
      permissions: {
        allow: [
          'Skill(notes-keeper)',
          'Skill(notes-keeper *)',
          'Skill(ghost-skill)',
          'Skill(ghost-prefix:*)',
        ],
        ask: ['Skill(ghost-ask *)'],
      },
    });
    expect(found.map((finding) => [finding.code, finding.subject])).toEqual([
      ['PERMISSION_UNKNOWN_SKILL', 'Skill(ghost-skill)'],
      ['PERMISSION_UNKNOWN_SKILL', 'Skill(ghost-prefix:*)'],
      ['PERMISSION_UNKNOWN_SKILL', 'Skill(ghost-ask *)'],
    ]);
  });

  it('leaves a wildcard and a plugin name alone, and reports an unknown helper as information', async () => {
    const found = await lint({
      permissions: {
        allow: ['Skill', 'Skill(*)', 'Skill(tools:build)', 'Agent(note-reader)', 'Agent(ghost-helper)'],
      },
    });
    expect(found.map((finding) => [finding.code, finding.subject])).toEqual([
      ['PERMISSION_UNKNOWN_HELPER', 'Agent(ghost-helper)'],
    ]);
    expect(INFORMATION.has('PERMISSION_UNKNOWN_HELPER')).toBe(true);
    expect(INFORMATION.has('PERMISSION_UNKNOWN_SKILL')).toBe(false);
  });

  it('flags a Read deny that an allowed shell rule with free arguments goes around', async () => {
    const found = await lint({
      permissions: {
        deny: ['Read(./private/**)', 'Edit(./private/**)'],
        allow: ['Bash(cat *)', 'Bash(git status)'],
      },
    });
    expect(found.map((finding) => [finding.code, finding.subject])).toEqual([
      ['PERMISSION_READ_BYPASS', 'Read(./private/**)'],
      ['PERMISSION_READ_BYPASS', 'Edit(./private/**)'],
    ]);
  });

  it('flags nothing when every allowed shell rule is exact', async () => {
    const found = await lint({
      permissions: { deny: ['Read(./private/**)'], allow: ['Bash(git status)', 'Read'] },
    });
    expect(found).toEqual([]);
  });

  it('flags the bypass mode only with an allow rule that lets any value through', async () => {
    const broad = await lint({ permissions: { defaultMode: 'bypassPermissions', allow: ['Bash'] } });
    expect(broad.map((finding) => finding.code)).toEqual(['PERMISSION_BYPASS_MODE']);
    const exact = await lint({
      permissions: { defaultMode: 'bypassPermissions', allow: ['Bash(git status)'] },
    });
    expect(exact).toEqual([]);
    const asking = await lint({ permissions: { defaultMode: 'default', allow: ['Bash'] } });
    expect(asking).toEqual([]);
  });

  it('says in the bypass finding that the dangerous-mode prompt is skipped', async () => {
    const found = await lint({
      skipDangerousModePermissionPrompt: true,
      permissions: { defaultMode: 'bypassPermissions', allow: ['Bash'] },
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('dangerous-mode prompt is skipped');
  });
});
