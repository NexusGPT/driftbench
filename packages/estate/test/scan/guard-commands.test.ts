import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scriptOf } from '../../src/index';
import { estate } from '../support';

describe('guard commands that change folder or wrap a shell', () => {
  it('anchors a relative script after a change into the project folder', () => {
    for (const command of [
      'cd "$CLAUDE_PROJECT_DIR" && python3 .claude/guards/a.py',
      'cd ${CLAUDE_PROJECT_DIR}; .claude/guards/a.py',
      'cd "$CLAUDE_PROJECT_DIR/" && python3 .claude/guards/a.py --strict',
    ]) {
      expect(scriptOf(command), command).toEqual({ script: '.claude/guards/a.py', anchored: true });
    }
  });

  it('resolves a script from a subfolder of the project the command changes into', () => {
    expect(scriptOf('cd "$CLAUDE_PROJECT_DIR"/.claude/guards && python3 a.py')).toEqual({
      script: '.claude/guards/a.py',
      anchored: true,
    });
  });

  it('leaves a script unanchored after a change into a relative or unknown folder', () => {
    expect(scriptOf('cd tools && python3 guards/a.py')).toEqual({ script: 'guards/a.py', anchored: false });
    expect(scriptOf('cd "$SOMEWHERE" && python3 guards/a.py')).toEqual({
      script: 'guards/a.py',
      anchored: false,
    });
  });

  it('reads the command a shell wrapper runs', () => {
    for (const command of [
      `bash -c 'python3 "$CLAUDE_PROJECT_DIR"/.claude/guards/a.py'`,
      `sh -c "python3 $CLAUDE_PROJECT_DIR/.claude/guards/a.py --strict"`,
      `/bin/zsh -lc 'exec "$CLAUDE_PROJECT_DIR"/.claude/guards/a.py'`,
    ]) {
      expect(scriptOf(command), command).toEqual({ script: '.claude/guards/a.py', anchored: true });
    }
    expect(scriptOf(`bash -c 'cd "$CLAUDE_PROJECT_DIR" && ./.claude/guards/a.py'`)).toEqual({
      script: '.claude/guards/a.py',
      anchored: true,
    });
    expect(scriptOf(`bash -c 'echo done'`)).toEqual({ anchored: false });
    // A shell that runs a script file is no wrapper.
    expect(scriptOf('bash .claude/guards/a.sh -c')).toEqual({
      script: '.claude/guards/a.sh',
      anchored: false,
    });
  });

  it('names a registry guard by the script its command runs', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/guards/CATALOGUE.json': JSON.stringify(
        {
          checks: [
            { id: 'C1', command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/guards/a.py', rules: ['R1'] },
            { id: 'C2', command: 'echo nothing', rules: ['R2'] },
          ],
        },
        null,
        2,
      ),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.registry.map((row) => [row.id, row.guard, row.enforces])).toEqual([
      ['C1', 'a.py', [{ id: 'R1' }]],
    ]);
  });
});
