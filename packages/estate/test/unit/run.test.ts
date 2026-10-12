import { existsSync } from 'node:fs';
import { chmod, cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type UnitTest, unitTestOf } from '@driftbench/generate';
import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeReader,
  casesFromSource,
  neutral,
  outcomeOf,
  runUnitTests,
  scanEstate,
  type UnitResult,
} from '../../src/index';
import { NOW, estate as written } from '../support';

/** A test estate whose hook scripts are executable, as an estate's own are. */
async function estate(files: Record<string, string>): Promise<string> {
  const root = await written(files);
  const hooks = join(root, '.claude/hooks');
  if (existsSync(hooks)) for (const name of await readdir(hooks)) await chmod(join(hooks, name), 0o755);
  return root;
}

const RULES =
  '# Rules\n\n- **R1.** Never run `git push --force` on any branch.\n- **R2.** Never say "obviously" in a reply.\n';
const BLOCK = `#!/bin/sh
# Enforces: R1
input=$(cat)
case "$input" in
  *"git push --force"*) echo "Force pushes are not allowed." >&2; exit 2 ;;
esac
exit 0
`;
const SETTINGS = (hooks: Record<string, unknown>) => JSON.stringify({ hooks });
const GUARD = {
  PreToolUse: [
    {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/block.sh' }],
    },
  ],
};

/** The unit tests code writes for the estate's guards, by test type, from a scan of it. */
/** The model's part of the scan, played by hand: the two rules of RULES as atoms. */
const PORT = {
  family: 'test',
  model: 'by hand',
  async complete() {
    return JSON.stringify({
      chunk: 'CLAUDE.md',
      atoms: [
        {
          kind: 'instruction',
          title: 'Never force-push',
          quote: 'Never run `git push --force` on any branch.',
          evidence: [{ type: 'tool_not_called', label: 'Bash' }],
        },
        {
          kind: 'register',
          title: 'Never say obviously',
          quote: 'Never say "obviously" in a reply.',
          evidence: [{ type: 'text', mustNot: ['obviously'] }],
        },
      ],
    });
  },
};

async function unitTests(root: string, types: string[]): Promise<UnitTest[]> {
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), port: PORT, now: NOW });
  const atoms = new Map(map.atoms.map((atom) => [atom.id, atom]));
  const out: UnitTest[] = [];
  for (const guard of map.atoms.filter((atom) => atom.kind === 'guard')) {
    for (const testType of types) {
      const row = {
        id: `row.${testType}`,
        atomIds: [guard.id],
        cell: {},
        testType,
        mode: 'unit',
        status: 'approved' as const,
      };
      const built = unitTestOf(row, guard, atoms, map.hash, `unit.${testType}.${guard.id}`);
      if (typeof built !== 'string') out.push(built);
    }
  }
  return out;
}

async function record(root: string, tests: UnitTest[]): Promise<UnitTest[]> {
  const run = await runUnitTests(tests, { root, reader: new ClaudeCodeReader(), record: true });
  return run.results.map((result) => result.recorded as UnitTest);
}

const status = (results: readonly UnitResult[]) => results.map((result) => [result.testType, result.status]);

describe('the estate unit runner on a guard', () => {
  it('records the guard on the original, passes on it again, and fails on a copy that dropped the guard', async () => {
    const files = {
      'CLAUDE.md': RULES,
      '.claude/settings.json': SETTINGS(GUARD),
      '.claude/hooks/block.sh': BLOCK,
    };
    const root = await estate(files);
    const tests = await record(
      root,
      await unitTests(root, ['guard_positive', 'guard_negative', 'guard_hostile']),
    );
    const positive = tests.find((test) => test.testType === 'guard_positive');
    expect(positive?.cases.map((entry) => [entry.payload, entry.expected])).toEqual([
      [
        { tool_name: 'Bash', tool_input: { command: 'git push --force', description: 'unit test' } },
        { decision: 'deny', exitCode: 2, message: 'Force pushes are not allowed.' },
      ],
    ]);
    const negative = tests.find((test) => test.testType === 'guard_negative');
    expect(negative?.cases[0]?.expected).toEqual({ decision: 'allow', exitCode: 0 });
    const hostile = tests.find((test) => test.testType === 'guard_hostile');
    expect(hostile?.cases.map((entry) => [entry.material, entry.inert ?? false])).toEqual([
      ['git  push  --force', true],
      ['GIT PUSH --FORCE', true],
      ["git '' push --force", true],
      ['echo ok && git push --force', false],
    ]);

    const again = await runUnitTests(tests, { root, reader: new ClaudeCodeReader() });
    expect(status(again.results)).toEqual([
      ['guard_positive', 'pass'],
      ['guard_negative', 'pass'],
      ['guard_hostile', 'pass'],
    ]);

    const parallel = await runUnitTests(tests, { root, reader: new ClaudeCodeReader(), jobs: 3 });
    expect(parallel.results).toEqual(
      again.results.map((result) => ({
        ...result,
        cases: result.cases.map((entry, index) => ({
          ...entry,
          ms: parallel.results[again.results.indexOf(result)]?.cases[index]?.ms,
        })),
      })),
    );

    const dropped = await estate({ ...files, '.claude/settings.json': SETTINGS({}) });
    const mutant = await runUnitTests(tests, { root: dropped, reader: new ClaudeCodeReader() });
    expect(status(mutant.results)).toEqual([
      ['guard_positive', 'fail'],
      ['guard_negative', 'fail'],
      ['guard_hostile', 'fail'],
    ]);
    expect(mutant.results[0]?.detail).toBe('the estate no longer runs the PreToolUse guard block.sh on Bash');
  });

  it('fails a case whose decision, exit code or message changed, and holds a speed budget', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/settings.json': SETTINGS(GUARD),
      '.claude/hooks/block.sh': BLOCK,
    });
    const tests = await record(root, await unitTests(root, ['guard_positive', 'guard_speed']));
    expect(tests[1]?.budgetMs).toBe(60_000);
    // The guard still runs, but says another thing; then it lets the push through.
    await writeFile(
      join(root, '.claude/hooks/block.sh'),
      BLOCK.replace('Force pushes are not allowed.', 'No.'),
    );
    const message = await runUnitTests(tests, { root, reader: new ClaudeCodeReader() });
    expect(message.results[0]?.detail).toBe('1 of 1 cases changed: case-01 another message');
    await writeFile(join(root, '.claude/hooks/block.sh'), '#!/bin/sh\nexit 0\n');
    const open = await runUnitTests(tests, { root, reader: new ClaudeCodeReader() });
    expect(open.results[0]?.detail).toBe(
      '1 of 1 cases changed: case-01 allow where deny was recorded; exit 0 where 2 was recorded; another message',
    );
    const slow = { ...(tests[1] as UnitTest), budgetMs: 1 };
    await writeFile(join(root, '.claude/hooks/block.sh'), BLOCK.replace('exit 2', 'sleep 0.2; exit 2'));
    const timed = await runUnitTests([slow], { root, reader: new ClaudeCodeReader() });
    expect(timed.results[0]?.status).toBe('fail');
    expect(timed.results[0]?.detail).toMatch(/over the budget of 1 ms/);
  });

  it('reports a test that was never recorded, and a positive case with no effect as inert', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/settings.json': SETTINGS({
        Stop: [{ hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/quiet.sh' }] }],
      }),
      '.claude/hooks/quiet.sh': '#!/bin/sh\n# Enforces: R2\ncat > /dev/null\nexit 0\n',
    });
    const tests = await unitTests(root, ['guard_positive']);
    const unrecorded = await runUnitTests(tests, { root, reader: new ClaudeCodeReader() });
    expect(unrecorded.results[0]?.status).toBe('unrecorded');
    const recorded = await record(root, tests);
    expect(recorded[0]?.cases.every((entry) => entry.inert)).toBe(true);
    const run = await runUnitTests(recorded, { root, reader: new ClaudeCodeReader() });
    expect(run.results[0]?.status).toBe('inert');
  });

  it('sends the payload in the runtime shape: the session fields, the last reply as last_assistant_message and in the transcript', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/settings.json': SETTINGS({
        Stop: [{ hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/echo.py' }] }],
      }),
      '.claude/hooks/echo.py': [
        '#!/usr/bin/env python3',
        '# Enforces: R2',
        'import json, sys',
        'event = json.load(sys.stdin)',
        'lines = open(event["transcript_path"]).read()',
        'keys = sorted(k for k in event if k != "transcript_path" and k != "cwd" and k != "session_id")',
        'print(json.dumps({"keys": keys, "event": event["hook_event_name"], "obviously": "obviously" in lines, "last": "obviously" in event.get("last_assistant_message", "")}))',
        '',
      ].join('\n'),
    });
    const [test] = await record(root, await unitTests(root, ['guard_positive']));
    const output = JSON.parse(test?.cases[0]?.expected?.output ?? '{}');
    expect(output).toEqual({
      keys: ['hook_event_name', 'last_assistant_message', 'permission_mode', 'stop_hook_active'],
      event: 'Stop',
      obviously: true,
      last: true,
    });
  });
});

describe('a catalogue check tested through its host hook', () => {
  it('counts a check as exercised only when the hook answers its trigger naming the check', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/settings.json': SETTINGS({
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/pre.sh' }],
          },
        ],
      }),
      '.claude/hooks/pre.sh': [
        '#!/bin/sh',
        'input=$(cat)',
        'case "$input" in',
        '  *2\\u003e/dev/null*|*2\\>/dev/null*|*"2>/dev/null"*) echo "[K1] stderr swallowed" >&2; exit 2 ;;',
        'esac',
        'exit 0',
        '',
      ].join('\n'),
    });
    const check = (id: string, material: string): UnitTest => ({
      id: `unit.guard_positive.guard.registry.${id}`,
      planRow: 'row',
      testType: 'guard_positive',
      atom: `guard.registry.${id}`,
      title: id,
      mapHash: 'x',
      target: {
        kind: 'guard',
        name: 'pre.sh',
        event: 'PreToolUse',
        matcher: 'Bash',
        command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/pre.sh',
        check: id,
      },
      cases: [
        {
          id: 'case-01',
          material,
          payload: { tool_name: 'Bash', tool_input: { command: material, description: 'unit test' } },
        },
      ],
    });
    const run = await runUnitTests([check('K1', 'ls 2>/dev/null'), check('K2', 'echo hi')], {
      root,
      reader: new ClaudeCodeReader(),
      record: true,
    });
    expect(run.results.map((result) => [result.atom, result.exercised])).toEqual([
      ['guard.registry.K1', true],
      ['guard.registry.K2', false],
    ]);
  });
});

describe('the outcome the runtime reads from a guard', () => {
  it('reads exit 2, a JSON permission decision, a block decision, continue false, and other exits', () => {
    const run = (exitCode: number, stdout = '', stderr = '') =>
      outcomeOf({ exitCode, stdout, stderr, timedOut: false });
    expect(run(2, '', 'no')).toEqual({ decision: 'deny', exitCode: 2, message: 'no' });
    const ask = JSON.stringify({
      hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: 'sure?' },
    });
    expect(run(0, ask)).toEqual({ decision: 'ask', exitCode: 0, message: 'sure?', output: ask });
    const block = JSON.stringify({ decision: 'block', reason: 'too long' });
    expect(run(0, block)).toEqual({ decision: 'deny', exitCode: 0, message: 'too long', output: block });
    const stop = JSON.stringify({ continue: false, stopReason: 'halt' });
    expect(run(0, stop).decision).toBe('deny');
    expect(run(1, '', 'boom')).toEqual({ decision: 'error', exitCode: 1, message: 'boom' });
    expect(run(0, 'context for the agent')).toEqual({
      decision: 'allow',
      exitCode: 0,
      output: 'context for the agent',
    });
    expect(outcomeOf({ exitCode: 137, stdout: '', stderr: '', timedOut: true }).message).toBe('timed out');
  });
});

describe.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))('the sandbox', () => {
  it('runs a guard with no network, no credential folder and no write outside the run', async () => {
    const outside = join(homedir(), '.ssh');
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/settings.json': SETTINGS(GUARD),
      '.claude/hooks/block.sh': [
        '#!/bin/sh',
        '# Enforces: R1',
        'cat > /dev/null',
        'net=open; /usr/bin/curl -s -m 3 https://example.com > /dev/null 2>&1 || net=closed',
        `ssh=open; ls "${outside}" > /dev/null 2>&1 || ssh=closed`,
        'write=open; touch /tmp/driftbench-unit-escape 2>/dev/null || write=closed',
        'home=$HOME',
        'echo "net=$net ssh=$ssh write=$write home=${home#/private}"',
        '',
      ].join('\n'),
    });
    const [test] = await record(root, await unitTests(root, ['guard_positive']));
    const output = test?.cases[0]?.expected?.output ?? '';
    expect(output).toMatch(/^net=closed ssh=closed write=closed home=/);
    expect(output).not.toContain(homedir());
    expect(existsSync('/tmp/driftbench-unit-escape')).toBe(false);
  });
});

describe('a script with declared fixtures', () => {
  it('runs each declared fixture and compares its exit code and stdout; no fixture is inert', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/skills/sum/SKILL.md': '---\nname: sum\n---\n\nRun `python3 scripts/sum.py <a> <b>`.\n',
      '.claude/skills/sum/scripts/sum.py': 'import sys\nprint(int(sys.argv[1]) + int(sys.argv[2]))\n',
      'driftbench.estate.yaml': [
        'scripts:',
        '  .claude/skills/sum/scripts/sum.py:',
        '    - { args: ["2", "3"], expect: { stdout: "5" } }',
        '    - { args: ["2", "x"], expect: { exitCode: 1 } }',
        '',
      ].join('\n'),
    });
    const test: UnitTest = {
      id: 'unit.script_fixture.sum',
      planRow: 'row',
      testType: 'script_fixture',
      atom: 'script.sum.sum',
      title: 'sum',
      mapHash: 'x',
      target: { kind: 'script', path: '.claude/skills/sum/scripts/sum.py' },
      cases: [],
    };
    const run = await runUnitTests([test], { root, reader: new ClaudeCodeReader() });
    expect(run.results[0]?.status).toBe('pass');
    await writeFile(
      join(root, '.claude/skills/sum/scripts/sum.py'),
      'import sys\nprint(int(sys.argv[1]) * int(sys.argv[2]))\n',
    );
    const broken = await runUnitTests([test], { root, reader: new ClaudeCodeReader() });
    expect(broken.results[0]?.detail).toBe('fixture-1: another stdout');
    const gone = await runUnitTests([{ ...test, target: { kind: 'script', path: '.claude/x.py' } }], {
      root,
      reader: new ClaudeCodeReader(),
    });
    expect(gone.results[0]).toMatchObject({
      status: 'fail',
      detail: 'the estate no longer holds .claude/x.py',
    });
    expect(await readFile(join(root, 'driftbench.estate.yaml'), 'utf8')).toContain('sum.py');
  });
});

describe('a TypeScript script', () => {
  it('runs offline in the sandbox, with no package fetched, in well under its timeout', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/skills/sum/scripts/sum.ts':
        'const total: number = Number(process.argv[2]) + Number(process.argv[3]);\nconsole.log(total);\n',
      'driftbench.estate.yaml': [
        'scripts:',
        '  .claude/skills/sum/scripts/sum.ts:',
        '    - { args: ["2", "3"], expect: { stdout: "5" } }',
        '',
      ].join('\n'),
    });
    const test: UnitTest = {
      id: 'unit.script_fixture.sum-ts',
      planRow: 'row',
      testType: 'script_fixture',
      atom: 'script.sum.sum-ts',
      title: 'sum',
      mapHash: 'x',
      target: { kind: 'script', path: '.claude/skills/sum/scripts/sum.ts' },
      cases: [],
    };
    const started = performance.now();
    const run = await runUnitTests([test], { root, reader: new ClaudeCodeReader() });
    expect([run.results[0]?.status, run.results[0]?.detail]).toEqual(['pass', '1 of 1 fixtures as declared']);
    expect(performance.now() - started).toBeLessThan(20_000);
  }, 60_000);
});

describe('the reader-cases script fixtures', () => {
  it('runs the fixtures driftbench.estate.yaml declares for the tracking script, and fails when they change', async () => {
    const cases = fileURLToPath(new URL('../../../../examples/estates/reader-cases/', import.meta.url));
    const test: UnitTest = {
      id: 'unit.script_fixture.track',
      planRow: 'row',
      testType: 'script_fixture',
      atom: 'script.shipment-tracker.script-scripts-track-sh',
      title: 'track.sh',
      mapHash: 'x',
      target: { kind: 'script', path: '.claude/skills/shipment-tracker/scripts/track.sh' },
      cases: [],
    };
    const run = await runUnitTests([test], { root: cases, reader: new ClaudeCodeReader() });
    expect(run.results[0]).toMatchObject({ status: 'pass', detail: '2 of 2 fixtures as declared' });
    const copy = await written({});
    await cp(cases, copy, { recursive: true, dereference: true });
    await writeFile(join(copy, '.claude/skills/shipment-tracker/scripts/track.sh'), '#!/bin/sh\nexit 0\n');
    const broken = await runUnitTests([test], { root: copy, reader: new ClaudeCodeReader() });
    expect(broken.results[0]?.detail).toBe(
      'fixture-1: exit 0 where 2 is declared | fixture-2: exit 0 where 1 is declared',
    );
  });
});

describe('minimal fixtures of a script with none declared', () => {
  it('reads how many arguments a script takes from its own parsing', () => {
    expect(casesFromSource('import sys\nprint(sys.argv[1], sys.argv[2])\n')[1]?.payload.args).toEqual([
      'arg-1',
      'arg-2',
    ]);
    expect(casesFromSource('if len(argv) != 3:\n    exit(2)\n')[1]?.payload.args).toEqual(['arg-1', 'arg-2']);
    expect(casesFromSource('if [ "$#" -ne 2 ]; then exit 2; fi\necho "$1"\n')[1]?.payload.args).toEqual([
      'arg-1',
      'arg-2',
    ]);
    expect(casesFromSource('echo hello\n')).toEqual([
      { id: 'case-01', payload: { args: [] }, material: 'no argument' },
    ]);
  });

  it('records the minimal fixtures on the original, passes on it, and fails when the script changes or goes', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/skills/sum/SKILL.md': '---\nname: sum\n---\n\nRun the sum.\n',
      '.claude/skills/sum/scripts/sum.py':
        'import sys\nif len(sys.argv) != 3:\n    sys.exit("usage: sum.py <a> <b>")\nprint(open(sys.argv[1]).read() == "")\n',
    });
    const test: UnitTest = {
      id: 'unit.script_fixture.sum',
      planRow: 'row',
      testType: 'script_fixture',
      atom: 'script.sum.sum',
      title: 'sum',
      mapHash: 'x',
      target: { kind: 'script', path: '.claude/skills/sum/scripts/sum.py' },
      cases: [],
    };
    const unrecorded = await runUnitTests([test], { root, reader: new ClaudeCodeReader() });
    expect(unrecorded.results[0]?.status).toBe('inert');
    const record = await runUnitTests([test], { root, reader: new ClaudeCodeReader(), record: true });
    const recorded = record.results[0]?.recorded as UnitTest;
    expect(recorded.cases.map((entry) => [entry.payload.args, entry.expected])).toEqual([
      [[], { decision: 'error', exitCode: 1, message: 'usage: sum.py <a> <b>' }],
      [['arg-1', 'arg-2'], { decision: 'allow', exitCode: 0, output: 'True' }],
    ]);
    expect(
      (await runUnitTests([recorded], { root, reader: new ClaudeCodeReader() })).results[0]?.status,
    ).toBe('pass');
    await writeFile(join(root, '.claude/skills/sum/scripts/sum.py'), 'print("changed")\n');
    const changed = await runUnitTests([recorded], { root, reader: new ClaudeCodeReader() });
    expect(changed.results[0]?.detail).toBe(
      'case-01: allow where error was recorded; exit 0 where 1 was recorded; another message | case-02: another output',
    );
  });

  it('names the run folders the same way on every run', () => {
    const work = '/var/folders/x/T/driftbench-unit-ab12';
    expect(neutral(`grep: /private${work}/estate/a.txt: none, at ${work}/case-17/x`, work)).toBe(
      'grep: $RUN/estate/a.txt: none, at $RUN/case/x',
    );
  });
});
