import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate } from '../support';

const SETTINGS = JSON.stringify({
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/shell.py' }],
      },
    ],
  },
});
const RULES = '# Rules\n\n- **R1.** Never delete a file under the archive folder.\n';

describe('forms the reader reads (executor pilot)', () => {
  it('reads a catalogue of checks: entries under hooks, the guard as a hook path, the rules under rules', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/settings.json': SETTINGS,
      '.claude/hooks/shell.py': 'import sys\nsys.exit(0)\n',
      '.claude/hooks/catalogue.json': JSON.stringify(
        { hooks: [{ id: 'C1', hook: '.claude/hooks/shell.py', rules: ['R1'] }] },
        null,
        2,
      ),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.registry.map((row) => [row.id, row.guard, row.enforces])).toEqual([
      ['C1', 'shell.py', [{ id: 'R1' }]],
    ]);
  });
});
