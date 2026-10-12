import { describe, expect, it } from 'vitest';
import type { EstateAtom } from '../../src/estate/inputs';
import {
  hostileForms,
  matcherTools,
  materialOf,
  payloadOf,
  scriptCases,
  unitTestOf,
} from '../../src/estate/unit';

const rule = (id: string, quote: string): EstateAtom => ({
  id,
  kind: 'instruction',
  title: id,
  approved: true,
  evidence: [],
  provenance: { quote },
});
const guard = (fields: Record<string, unknown>): EstateAtom => ({
  id: 'guard.settings.g',
  kind: 'guard',
  title: 'the guard',
  approved: true,
  evidence: [],
  fields: {
    name: 'g.sh',
    command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/g.sh',
    enforces: [{ atom: 'r1', by: 'id' }],
    ...fields,
  },
});
const ATOMS = new Map([
  ['r1', rule('r1', 'Never run `git push --force` or `rm -rf` on any branch.')],
  ['r2', rule('r2', 'Never say "obviously" in a reply.')],
]);
const row = (testType: string) => ({
  id: `row.${testType}`,
  atomIds: ['guard.settings.g'],
  cell: {},
  testType,
  mode: 'unit',
  status: 'approved' as const,
});

describe('the payloads of a guard unit test', () => {
  it('reads the tools of a matcher and the material of a rule quote', () => {
    expect(matcherTools('Edit|Write')).toEqual(['Edit', 'Write']);
    expect(matcherTools(undefined)).toEqual(['Bash']);
    expect(matcherTools('*')).toEqual(['Bash']);
    expect(materialOf('Never run `git push --force` or `rm -rf` on any branch.')).toEqual([
      'git push --force',
      'rm -rf',
    ]);
    expect(materialOf('Never say "obviously" in a reply.')).toEqual(['obviously']);
    expect(materialOf('Read a file before you edit it.')).toEqual(['Read a file before you edit it.']);
  });

  it('builds each event in the runtime input shape', () => {
    expect(payloadOf('PreToolUse', 'Bash', 'ls')).toEqual({
      tool_name: 'Bash',
      tool_input: { command: 'ls', description: 'unit test' },
    });
    expect(payloadOf('PostToolUse', 'Edit', 'ledger/a.csv')).toEqual({
      tool_name: 'Edit',
      tool_input: { file_path: 'ledger/a.csv', old_string: 'a', new_string: 'b' },
      tool_response: { stdout: '', stderr: '', interrupted: false },
    });
    expect(payloadOf('UserPromptSubmit', undefined, 'stop')).toEqual({ prompt: 'stop' });
    expect(payloadOf('Stop', undefined, 'obviously')).toEqual({
      stop_hook_active: false,
      last_reply: 'obviously',
    });
    expect(hostileForms('git push --force')).toEqual([
      'git  push  --force',
      'GIT PUSH --FORCE',
      "git '' push --force",
      'echo ok && git push --force',
    ]);
  });

  it('writes positive, hostile, negative and speed cases from the rules a guard enforces', () => {
    const atom = guard({ event: 'PreToolUse', matcher: 'Bash', timeout: 5 });
    const positive = unitTestOf(row('guard_positive'), atom, ATOMS, 'h', 'unit.guard_positive.g');
    if (typeof positive === 'string') throw new Error(positive);
    expect(positive.target).toEqual({
      kind: 'guard',
      name: 'g.sh',
      event: 'PreToolUse',
      matcher: 'Bash',
      command: atom.fields?.command,
      timeout: 5,
    });
    expect(positive.cases.map((entry) => entry.material)).toEqual(['git push --force', 'rm -rf']);
    const hostile = unitTestOf(row('guard_hostile'), atom, ATOMS, 'h', 'unit.guard_hostile.g');
    expect(typeof hostile !== 'string' && hostile.cases).toHaveLength(8);
    const negative = unitTestOf(row('guard_negative'), atom, ATOMS, 'h', 'unit.guard_negative.g');
    expect(typeof negative !== 'string' && negative.cases.map((entry) => entry.payload)).toEqual([
      { tool_name: 'Bash', tool_input: { command: 'ls', description: 'unit test' } },
    ]);
    const speed = unitTestOf(row('guard_speed'), atom, ATOMS, 'h', 'unit.guard_speed.g');
    expect(typeof speed !== 'string' && speed.budgetMs).toBe(5000);
  });

  it('names why a guard that enforces no rule gets no positive test, and points a script test at its file', () => {
    const lone = guard({ event: 'Stop', enforces: [] });
    expect(unitTestOf(row('guard_positive'), lone, ATOMS, 'h', 'x')).toBe(
      'guard.settings.g enforces no rule whose quote gives material for a payload',
    );
    expect(typeof unitTestOf(row('guard_negative'), lone, ATOMS, 'h', 'x')).toBe('object');
    const script: EstateAtom = {
      id: 'script.a.s',
      kind: 'script',
      title: 's',
      approved: true,
      evidence: [],
      fields: { path: '.claude/skills/a/s.py', skill: 'a' },
    };
    expect(unitTestOf(row('script_fixture'), script, ATOMS, 'h', 'unit.script_fixture.s')).toMatchObject({
      target: { kind: 'script', path: '.claude/skills/a/s.py', skill: 'a' },
      cases: [{ id: 'case-01', payload: { args: [] }, material: 'no argument' }],
    });
  });
});

describe('minimal fixtures of a script with none declared', () => {
  it('runs the script bare, then as each command line of its quote writes it, placeholders as empty files', () => {
    expect(
      scriptCases(
        '3. Run `python3 scripts/reconcile.py <invoice> <order>` and show the summary.',
        '.claude/skills/a/scripts/reconcile.py',
      ),
    ).toEqual([
      { id: 'case-01', payload: { args: [] }, material: 'no argument' },
      {
        id: 'case-02',
        payload: { args: ['invoice', 'order'], files: { invoice: '', order: '' } },
        material: 'invoice order',
      },
    ]);
    expect(
      scriptCases('as in `./scripts/track.sh NWX 123`, never `track.sh NWX 123` twice', 'x/scripts/track.sh'),
    ).toEqual([
      { id: 'case-01', payload: { args: [] }, material: 'no argument' },
      { id: 'case-02', payload: { args: ['NWX', '123'] }, material: 'NWX 123' },
    ]);
    expect(scriptCases('Run the tracker.', 'x/track.sh')).toHaveLength(1);
  });
});
