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

  it('takes only the spans a rule forbids, never every name or path it mentions', () => {
    expect(materialOf('Read `a.md` first. Never use `sed -i` on a drive.')).toEqual(['sed -i']);
    expect(materialOf('See `nexus-app-builder` and "the build guide" for the build.')).toEqual([]);
    expect(materialOf('✗ `2>/dev/null` swallows the error; ✓ `2>&1`')).toEqual(['2>/dev/null']);
    expect(materialOf('No `npx`, no raw `curl`.\nUse `nexus` instead.')).toEqual(['npx', 'curl']);
    expect(materialOf('Do not say "obviously" in a reply.')).toEqual(['obviously']);
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

describe('material from a rule the guard cites', () => {
  it('takes every concrete span of the rule source lines, and never sends a sentence as a tool payload', () => {
    const cited: EstateAtom = {
      ...rule('r1', 'Every failure reaches you, any spelling'),
      fields: { spans: ['2>/dev/null', '|| true'] },
    };
    const prose = rule('r2', 'Never guess a status.');
    const atoms = new Map([
      ['r1', cited],
      ['r2', prose],
    ]);
    const bash = guard({
      event: 'PreToolUse',
      matcher: 'Bash',
      enforces: [
        { atom: 'r1', by: 'id' },
        { atom: 'r2', by: 'id' },
      ],
    });
    const positive = unitTestOf(row('guard_positive'), bash, atoms, 'h', 'p');
    expect(typeof positive !== 'string' && positive.cases.map((entry) => entry.material)).toEqual([
      '2>/dev/null',
      '|| true',
    ]);
    const prompt = guard({ event: 'UserPromptSubmit', enforces: [{ atom: 'r2', by: 'id' }] });
    const asked = unitTestOf(row('guard_positive'), prompt, atoms, 'h', 'q');
    expect(typeof asked !== 'string' && asked.cases.map((entry) => entry.material)).toEqual([
      'Never guess a status.',
    ]);
  });
});

describe('the rules a guard test takes material from', () => {
  it('takes the rules linked by registry or cited id, and a rule linked only by a repeated quote when no other link exists', () => {
    const atoms = new Map([
      ['r1', rule('r1', 'Never run `rm -rf` here.')],
      ['r2', rule('r2', 'Never write `2>/dev/null` after a command.')],
    ]);
    const linked = guard({
      event: 'PreToolUse',
      matcher: 'Bash',
      enforces: [
        { atom: 'r1', by: 'quote' },
        { atom: 'r2', by: 'id' },
      ],
    });
    const positive = unitTestOf(row('guard_positive'), linked, atoms, 'h', 'p');
    expect(typeof positive !== 'string' && positive.cases.map((entry) => entry.material)).toEqual([
      '2>/dev/null',
    ]);
    const quoteOnly = guard({
      event: 'PreToolUse',
      matcher: 'Bash',
      enforces: [{ atom: 'r1', by: 'quote' }],
    });
    const fallback = unitTestOf(row('guard_positive'), quoteOnly, atoms, 'h', 'q');
    expect(typeof fallback !== 'string' && fallback.cases.map((entry) => entry.material)).toEqual(['rm -rf']);
  });
});

describe('the speed test of a guard', () => {
  it('times a spread of at most five positive payloads, not every one', () => {
    const quote = Array.from({ length: 12 }, (_, index) => `\`cmd-${index + 1}\``).join(' ');
    const many = new Map([['r1', rule('r1', `Never run ${quote}.`)]]);
    const atom = guard({ event: 'PreToolUse', matcher: 'Bash' });
    const positive = unitTestOf(row('guard_positive'), atom, many, 'h', 'p');
    const speed = unitTestOf(row('guard_speed'), atom, many, 'h', 's');
    if (typeof positive === 'string' || typeof speed === 'string') throw new Error('no test');
    expect(positive.cases).toHaveLength(12);
    expect(speed.cases.map((entry) => entry.material)).toEqual([
      'cmd-1',
      'cmd-4',
      'cmd-7',
      'cmd-9',
      'cmd-12',
    ]);
    expect(speed.cases.map((entry) => entry.id)).toEqual([
      'case-01',
      'case-02',
      'case-03',
      'case-04',
      'case-05',
    ]);
  });
});

describe('a check from a catalogue', () => {
  const host: EstateAtom = {
    id: 'guard.settings.pre',
    kind: 'guard',
    title: 'pre',
    approved: true,
    evidence: [],
    fields: {
      name: 'pre.py',
      event: 'PreToolUse',
      matcher: 'Bash',
      command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre.py',
      script: '.claude/hooks/pre.py',
      scope: 'estate',
    },
  };
  const atoms = new Map([...ATOMS, [host.id, host]]);
  const check = (fields: Record<string, unknown>): EstateAtom => ({
    id: 'guard.registry.k1',
    kind: 'guard',
    title: 'K1',
    approved: true,
    evidence: [],
    fields: {
      name: 'K1',
      command: 'K1',
      event: 'PreToolUse (Bash)',
      scope: 'catalogue',
      check: 'K1',
      ...fields,
    },
  });

  it('is tested as a check of its host hook: its trigger material sent to that hook, the check id carried', () => {
    const test = unitTestOf(
      row('guard_positive'),
      check({ trigger: ['2>/dev/null'], host: '.claude/hooks/pre.py' }),
      atoms,
      'h',
      'x',
    );
    expect(test).toMatchObject({
      atom: 'guard.registry.k1',
      target: { kind: 'guard', name: 'pre.py', event: 'PreToolUse', matcher: 'Bash', check: 'K1' },
      cases: [
        { material: '2>/dev/null', payload: { tool_name: 'Bash', tool_input: { command: '2>/dev/null' } } },
      ],
    });
  });

  it('is a counted gap, not a test, without a trigger or a host hook; its other test types are its host hook tests', () => {
    expect(unitTestOf(row('guard_positive'), check({ host: '.claude/hooks/pre.py' }), atoms, 'h', 'x')).toBe(
      'guard.registry.k1 needs a trigger: the map holds no material that sets the check off',
    );
    const noHost = 'guard.registry.k1 needs a host: no configured hook on its event names the check';
    expect(unitTestOf(row('guard_positive'), check({ trigger: ['x'] }), atoms, 'h', 'x')).toBe(noHost);
    const stop = check({ trigger: ['x'], host: '.claude/hooks/pre.py', event: 'Stop' });
    expect(unitTestOf(row('guard_positive'), stop, atoms, 'h', 'x')).toBe(noHost);
    for (const type of ['guard_negative', 'guard_hostile', 'guard_speed']) {
      const hosted = check({ trigger: ['x'], host: '.claude/hooks/pre.py' });
      expect(unitTestOf(row(type), hosted, atoms, 'h', 'x')).toBe(
        'guard.registry.k1 is a check its host hook runs; the host hook tests cover this test type',
      );
    }
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
