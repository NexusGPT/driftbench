import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { payloadOf, type UnitTest } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, guardLiterals, runUnitTests } from '../../src/index';
import { estate } from '../support';

// Every file below is invented: the dock, its crates and its scrap bin exist nowhere.
const SETTINGS = (event: string, matcher: string | undefined, script: string) =>
  JSON.stringify({
    hooks: {
      [event]: [
        {
          ...(matcher ? { matcher } : {}),
          hooks: [{ type: 'command', command: `python3 "$CLAUDE_PROJECT_DIR"/.claude/guards/${script}` }],
        },
      ],
    },
  });

/** A command is refused when it removes something under dock/: two things in one test. */
const DOCK = `import json, sys
event = json.load(sys.stdin)
command = event.get("tool_input", {}).get("command", "")
if "scrap " in command and "dock/" in command:
    print("move crates to dock/archive/ instead", file=sys.stderr)
    sys.exit(1)
sys.exit(0)
`;

/** A reply is refused when it is longer than 300 characters. */
const LONG = `import json, sys
event = json.load(sys.stdin)
reply = event.get("last_assistant_message", "")
if len(reply) > 300:
    print("keep the reply short", file=sys.stderr)
    sys.exit(2)
sys.exit(0)
`;

function positive(
  name: string,
  event: string,
  matcher: string | undefined,
  tool: string | undefined,
  material: string,
): UnitTest {
  return {
    id: `unit.guard_positive.${name}`,
    planRow: 'guard_positive.row',
    testType: 'guard_positive',
    atom: `guard.${name}`,
    title: name,
    mapHash: 'hash',
    target: {
      kind: 'guard',
      name,
      event,
      ...(matcher ? { matcher } : {}),
      command: `python3 "$CLAUDE_PROJECT_DIR"/.claude/guards/${name}`,
    },
    cases: [{ id: 'case-01', payload: payloadOf(event, tool, material), material }],
  };
}

async function recorded(files: Record<string, string>, test: UnitTest, guard: string): Promise<UnitTest> {
  const root = await estate({ ...files });
  await chmod(join(root, '.claude/guards', guard), 0o755);
  const run = await runUnitTests([test], { root, reader: new ClaudeCodeReader(), record: true });
  return run.results[0]?.recorded as UnitTest;
}

describe('a positive guard test whose every case is inert', () => {
  it('gains a case built from the literals of the guard itself, when the guard needs two of them', async () => {
    const test = recorded(
      {
        'CLAUDE.md': '# Dock\n',
        '.claude/settings.json': SETTINGS('PostToolUse', 'Bash', 'dock.py'),
        '.claude/guards/dock.py': DOCK,
      },
      positive('dock.py', 'PostToolUse', 'Bash', 'Bash', 'dock/'),
      'dock.py',
    );
    const done = await test;
    const first = done.cases[0];
    expect(first?.inert).toBe(true);
    const found = done.cases.filter((entry) => entry.found === true);
    expect(found).toHaveLength(1);
    expect(found[0]?.material).toBe('scrap dock/');
    expect(found[0]?.inert).toBeUndefined();
    expect(found[0]?.expected).toMatchObject({
      exitCode: 1,
      message: 'move crates to dock/archive/ instead',
    });
  }, 120_000);

  it('gains a reply just past the number the guard compares a length with', async () => {
    const done = await recorded(
      {
        'CLAUDE.md': '# Dock\n',
        '.claude/settings.json': SETTINGS('Stop', undefined, 'long.py'),
        '.claude/guards/long.py': LONG,
      },
      positive('long.py', 'Stop', undefined, undefined, 'Keep the reply short.'),
      'long.py',
    );
    const found = done.cases.filter((entry) => entry.found === true);
    expect(found).toHaveLength(1);
    expect(found[0]?.material).toHaveLength(301);
    expect(found[0]?.expected).toMatchObject({ decision: 'deny', exitCode: 2 });
  }, 120_000);

  it('adds nothing when a case of the test already shows the guard at work', async () => {
    const done = await recorded(
      {
        'CLAUDE.md': '# Dock\n',
        '.claude/settings.json': SETTINGS('PostToolUse', 'Bash', 'dock.py'),
        '.claude/guards/dock.py': DOCK,
      },
      positive('dock.py', 'PostToolUse', 'Bash', 'Bash', 'scrap dock/old.csv'),
      'dock.py',
    );
    expect(done.cases).toHaveLength(1);
    expect(done.cases[0]?.found).toBeUndefined();
  }, 120_000);

  it('adds nothing for a guard that blocks nothing the test could build', async () => {
    const done = await recorded(
      {
        'CLAUDE.md': '# Dock\n',
        '.claude/settings.json': SETTINGS('PostToolUse', 'Bash', 'dock.py'),
        '.claude/guards/dock.py': 'import sys\nsys.exit(0)\n',
      },
      positive('dock.py', 'PostToolUse', 'Bash', 'Bash', 'dock/'),
      'dock.py',
    );
    expect(done.cases).toHaveLength(1);
    expect(done.cases[0]?.inert).toBe(true);
  }, 120_000);
});

describe('the literals of a guard source', () => {
  it('lists the quoted strings in order, without comments and without the same string twice', () => {
    const source = `# "not this"\nif "scrap " in command and "dock/" in command:  # "nor this"\n    print('dock/')\n`;
    expect(guardLiterals(source)).toEqual(['scrap ', 'dock/']);
  });

  it('reads a shell pattern and a triple quoted string', () => {
    expect(guardLiterals('case "$x" in *"git push --force"*) ;; esac')).toEqual(['$x', 'git push --force']);
    expect(guardLiterals('"""Blocks a crate."""\nx = 1')).toEqual(['Blocks a crate.']);
  });
});
