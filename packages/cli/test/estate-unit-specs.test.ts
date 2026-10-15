import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { type Io, main } from '../src/index';

/**
 * `estate unit` on generated specs of mode unit: each spec carries its run (`metadata.estate.unit`) and is
 * judged by its own Then. The estate here is a small garden-centre estate written for this test, not the
 * Northwind fixture.
 */

async function run(argv: string[], cwd: string) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

const NO_DROP = `#!/bin/sh
input=$(cat)
case "$input" in
  *"dropdb"*) echo "Never drop the plant database." >&2; exit 2 ;;
esac
exit 0
`;
// Run by a relative path, as many estates do: the runtime runs it from the project folder.
const WARN = `import json, sys
event = json.load(sys.stdin)
command = event.get("tool_input", {}).get("command", "")
if "rm " in command and "orders/" in command:
    print("never remove an order file; archive it", file=sys.stderr)
    sys.exit(1)
sys.exit(0)
`;
const COUNT = `#!/bin/sh
# Usage: count.sh <file>
if [ "$#" -ne 1 ]; then echo "usage: count.sh <file>" >&2; exit 2; fi
wc -l < "$1"
`;

async function garden(overrides: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'garden-estate-'));
  const files: Record<string, string> = {
    'CLAUDE.md': '# Garden centre\n\nNever drop the plant database.\n',
    '.claude/settings.json': JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/no-drop.sh' }],
          },
        ],
        PostToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 .claude/hooks/warn.py' }] },
        ],
      },
    }),
    '.claude/hooks/no-drop.sh': NO_DROP,
    '.claude/hooks/warn.py': WARN,
    '.claude/skills/stock/SKILL.md':
      '---\nname: stock\ndescription: Counts the stock.\n---\nRun `scripts/count.sh <file>`.\n',
    '.claude/skills/stock/scripts/count.sh': COUNT,
    '.claude/agents/potter.md':
      '---\nname: potter\ndescription: Repots plants.\n---\nYou repot one plant and say which pot.\n',
    ...overrides,
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
    if (path.endsWith('.sh')) await chmod(join(root, path), 0o755);
  }
  return root;
}

const NO_DROP_TARGET = {
  kind: 'guard',
  name: 'no-drop.sh',
  event: 'PreToolUse',
  matcher: 'Bash',
  command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/no-drop.sh',
  verdict: 'deny',
};
const WARN_TARGET = {
  kind: 'guard',
  name: 'warn.py',
  event: 'PostToolUse',
  matcher: 'Bash',
  command: 'python3 .claude/hooks/warn.py',
  verdict: 'warn',
};
const bash = (id: string, command: string) => ({
  id,
  payload: { tool_name: 'Bash', tool_input: { command, description: 'unit test' } },
  material: command,
});

function spec(
  id: string,
  testType: string,
  unit: Record<string, unknown>,
  expect: Record<string, unknown>,
  custom?: Record<string, unknown>,
) {
  return {
    id,
    kind: 'task',
    title: id,
    target: { adapter: 'claude-code' },
    blocks: [{ id: 'ask', when: { user: 'Tidy up the shop.' }, expect }],
    ...(custom ? { rules: { custom } } : {}),
    metadata: { estate: { mode: 'unit', testType, unit } },
  };
}

const SPECS = {
  'register.yaml': spec(
    'garden.guard_register.no-drop',
    'guard_register',
    { target: NO_DROP_TARGET, cases: [bash('case-01', 'dropdb plants')], budgetMs: 60000 },
    {
      guards: [{ name: 'no-drop.sh', verdict: 'deny', count: { min: 1 } }],
      workspace: { others_untouched: true },
    },
    { guard_message: { name: 'no-drop.sh', mustNot: ['\\?'], block: 0 } },
  ),
  'negative.yaml': spec(
    'garden.guard_negative.no-drop',
    'guard_negative',
    { target: NO_DROP_TARGET, cases: [bash('case-01', 'ls')], budgetMs: 60000 },
    { guards: [{ name: 'no-drop.sh', verdict: 'deny', count: 0 }] },
  ),
  'warn.yaml': spec(
    'garden.guard_register.warn',
    'guard_register',
    { target: WARN_TARGET, cases: [bash('case-01', 'rm orders/')], budgetMs: 60000 },
    { guards: [{ name: 'warn.py', verdict: 'warn', count: { min: 1 } }] },
  ),
  'script.yaml': spec(
    'garden.script_fixture.count',
    'script_fixture',
    {
      target: { kind: 'script', path: '.claude/skills/stock/scripts/count.sh' },
      cases: [
        { id: 'case-01', payload: { args: [] }, material: 'no argument' },
        { id: 'case-02', payload: { args: ['file'], files: { file: 'a\nb\n' } }, material: 'file' },
      ],
    },
    { execution: { ran_code: true } },
  ),
  'helper.yaml': spec(
    'garden.contract_alone.potter',
    'contract_alone',
    { target: { kind: 'subagent', name: 'potter', file: '.claude/agents/potter.md' }, cases: [] },
    { workspace: { others_untouched: true } },
  ),
};

async function suite(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'garden-specs-'));
  for (const [name, body] of Object.entries(SPECS)) await writeFile(join(dir, name), stringify(body));
  // A spec of another mode in the same folder is left alone.
  await writeFile(
    join(dir, 'live.yaml'),
    stringify({ ...spec('garden.live', 'obligation', {}, {}), metadata: { estate: { mode: 'live' } } }),
  );
  return dir;
}

type Contract = {
  runs: Array<{ spec: string; pass: boolean; failing: string[] }>;
  guards: Array<{ guard: string; decision: string; message?: string; ms: number }>;
  scripts: Array<{ script: string; exit: number; stdout: string }>;
};

describe('estate unit on unit-mode specs', () => {
  it('runs each spec on the payloads it carries and judges it by its own Then', async () => {
    const root = await garden();
    const result = await run(['estate', 'unit', await suite(), '--estate', root, '--json'], root);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    const contract = JSON.parse(result.out) as Contract;
    expect(contract.runs.map((entry) => [entry.spec, entry.pass]).sort()).toEqual([
      ['garden.contract_alone.potter', true],
      ['garden.guard_negative.no-drop', true],
      ['garden.guard_register.no-drop', true],
      ['garden.guard_register.warn', true],
      ['garden.script_fixture.count', true],
    ]);
    expect(contract.guards).toContainEqual({
      guard: 'no-drop.sh',
      event: 'PreToolUse',
      decision: 'deny',
      message: 'Never drop the plant database.',
      ms: expect.any(Number),
    });
    // The relative command found its script: the hook ran in the estate's folder, and warned.
    expect(contract.guards).toContainEqual(
      expect.objectContaining({
        guard: 'warn.py',
        decision: 'allow',
        message: 'never remove an order file; archive it',
      }),
    );
    expect(contract.scripts.map((entry) => entry.exit)).toEqual([2, 0]);
  }, 120_000);

  it('turns red when a guard lets everything through, blocks everything, or crashes', async () => {
    const dir = await suite();
    const allowAll = await garden({ '.claude/hooks/no-drop.sh': '#!/bin/sh\ncat > /dev/null\nexit 0\n' });
    const open = JSON.parse(
      (await run(['estate', 'unit', dir, '--estate', allowAll, '--json'], allowAll)).out,
    ) as Contract;
    expect(open.runs.find((entry) => entry.spec === 'garden.guard_register.no-drop')?.failing[0]).toContain(
      'no-drop.sh with verdict deny fired 0 times',
    );

    const blockAll = await garden({ '.claude/hooks/no-drop.sh': '#!/bin/sh\ncat > /dev/null\nexit 2\n' });
    const shut = JSON.parse(
      (await run(['estate', 'unit', dir, '--estate', blockAll, '--json'], blockAll)).out,
    ) as Contract;
    expect(shut.runs.find((entry) => entry.spec === 'garden.guard_negative.no-drop')?.pass).toBe(false);

    // A Python guard replaced by a shell script crashes under python3: exit 1, a syntax error. It enforces nothing.
    const crashed = await garden({ '.claude/hooks/warn.py': '#!/bin/sh\necho "warn" >&2\nexit 1\n' });
    const broken = JSON.parse(
      (await run(['estate', 'unit', dir, '--estate', crashed, '--json'], crashed)).out,
    ) as Contract;
    expect(broken.runs.find((entry) => entry.spec === 'garden.guard_register.warn')?.failing[0]).toContain(
      'the guard crashed, exit 1',
    );
  }, 180_000);

  it('fails a script that answers without its usage, and a helper whose agent file lost its body', async () => {
    const dir = await suite();
    const root = await garden({
      '.claude/skills/stock/scripts/count.sh': '#!/bin/sh\necho "something went wrong" >&2\nexit 1\n',
      '.claude/agents/potter.md': '---\nname: potter\ndescription: Repots plants.\n---\n',
    });
    const result = JSON.parse(
      (await run(['estate', 'unit', dir, '--estate', root, '--json'], root)).out,
    ) as Contract;
    const failing = (id: string) => result.runs.find((entry) => entry.spec === id)?.failing ?? [];
    expect(failing('garden.script_fixture.count')[0]).toContain('exit 1 with no usage line');
    expect(failing('garden.contract_alone.potter')[0]).toContain('has no body');
  }, 120_000);

  it('refuses --record on specs, and a unit-mode spec named on its own that carries no run', async () => {
    const root = await garden();
    const dir = await suite();
    const record = await run(
      ['estate', 'unit', join(dir, 'register.yaml'), '--estate', root, '--record'],
      root,
    );
    expect(record.code).toBe(2);
    expect(record.err).toContain('a unit-mode spec carries its own Then');
    const bare = join(dir, 'bare.yaml');
    await writeFile(
      bare,
      stringify({ ...spec('garden.bare', 'guard_negative', {}, {}), metadata: { estate: { mode: 'unit' } } }),
    );
    const missing = await run(['estate', 'unit', bare, '--estate', root], root);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('carries no run (metadata.estate.unit)');
  });
});
