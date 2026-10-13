import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { readFrontmatter } from '../../src/scan/text';
import { estate } from '../support';

describe('frontmatter with carriage returns or tabs', () => {
  it('reads a block the strict parser refuses when its lines end in carriage returns', () => {
    const text = [
      '---',
      'name: plan',
      'description: Use when: the user asks to plan.',
      '---',
      '',
      'Body.',
    ].join('\r\n');
    const read = readFrontmatter(text);
    expect(read.error).toBeUndefined();
    expect(read.fields).toEqual({ name: 'plan', description: 'Use when: the user asks to plan.' });
    expect(read.bodyLine).toBe(5);
  });

  it('keeps no carriage return in a value the strict parser accepts', () => {
    const read = readFrontmatter("---\r\nname: plan\r\ncommand: 'a || b'\r\n---\r\nBody.\r\n");
    expect(read.error).toBeUndefined();
    expect(read.tolerated).toBeUndefined();
    expect(read.fields).toEqual({ name: 'plan', command: 'a || b' });
  });

  it('reads a list indented with tabs as a list', () => {
    const read = readFrontmatter('---\nname: pack\nallowed-tools:\n\t- Read\n\t- Edit\n---\n\nBody.\n');
    expect(read.fields).toEqual({ name: 'pack', 'allowed-tools': ['Read', 'Edit'] });
  });

  it('reads a skill hook and its route from a frontmatter with carriage returns', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/sort/scripts/check.sh': '#!/bin/sh\nexit 0\n',
      '.claude/skills/sort/SKILL.md': [
        '---',
        'name: sort',
        'description: the user asks to sort a shelf.',
        'hooks:',
        '  PreToolUse:',
        '    - matcher: Bash',
        '      hooks:',
        '        - type: command',
        `          command: '[ "$QUIET" = "$PPID" ] || "$CLAUDE_PROJECT_DIR"/.claude/skills/sort/scripts/check.sh'`,
        '---',
        '',
        'Always name the shelf.',
        '',
      ].join('\r\n'),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.notes).toEqual([]);
    expect(raw.skills[0]?.description?.value).toBe('the user asks to sort a shelf.');
    expect(raw.guards.map((guard) => [guard.script, guard.at.startLine])).toEqual([
      ['.claude/skills/sort/scripts/check.sh', 9],
    ]);
  });

  it('declares the tools of a tab-indented list by their names', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/pack/SKILL.md':
        '---\nname: pack\ndescription: Packs.\nallowed-tools:\n\t- Read\n---\n\nBody.\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.skills[0]?.tools.map((tool) => [tool.value, tool.at.startLine])).toEqual([['Read', 5]]);
  });
});
