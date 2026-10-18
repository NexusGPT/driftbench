import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Observed } from '@agent-nexus/driftbench-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  diffTrees,
  type JsonlLine,
  mapSession,
  NotATranscriptError,
  parseJsonl,
  type ReplayRaw,
  readSession,
  treeOf,
} from '../../src/claude-code';

const SESSIONS = fileURLToPath(new URL('../../../../examples/estates/sessions/', import.meta.url));
const CWD = '/work/demo';
const SID = 'session-a';

let clock = 0;
const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 9, 0, seconds)).toISOString();
const base = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  sessionId: SID,
  cwd: CWD,
  version: '2.0.0',
  timestamp: at(clock++),
  ...extra,
});
const user = (content: unknown, extra: Record<string, unknown> = {}) =>
  base('user', { message: { role: 'user', content }, ...extra });
const assistant = (content: unknown[], extra: Record<string, unknown> = {}) =>
  base('assistant', {
    message: { id: `m${clock}`, role: 'assistant', content, usage: { input_tokens: 10, output_tokens: 2 } },
    ...extra,
  });
const use = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
const result = (id: string, content: unknown, extra: Record<string, unknown> = {}, isError = false) =>
  user([{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }], extra);

function lines(records: unknown[]): JsonlLine[] {
  return parseJsonl(
    records.map((record) => (typeof record === 'string' ? record : JSON.stringify(record))).join('\n'),
  );
}

function map(records: unknown[], more: Partial<Parameters<typeof mapSession>[0]> = {}) {
  clock = 0;
  return mapSession({ transcript: lines(records), ...more });
}

describe('parseJsonl', () => {
  it('skips blank lines and keeps a line that is not JSON with its error', () => {
    const parsed = parseJsonl('{"a":1}\n\n not json\n');
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ line: 1, ok: true, value: { a: 1 } });
    expect(parsed[1]).toMatchObject({ line: 3, ok: false, text: ' not json' });
  });
});

describe('mapSession: turns and text', () => {
  it('opens a block on each typed user message, string or text blocks', () => {
    clock = 0;
    const session = mapSession({
      transcript: lines([
        user('first ask'),
        assistant([
          { type: 'text', text: 'one' },
          { type: 'text', text: 'two' },
        ]),
        user([{ type: 'text', text: 'second ask' }]),
        assistant([{ type: 'text', text: 'three' }]),
      ]),
    });
    expect(session.blocks.map((block) => block.stimulus)).toEqual([
      { user: 'first ask' },
      { user: 'second ask' },
    ]);
    const [first] = session.blocks;
    expect(first?.observed.text).toBe('one\n\ntwo');
    expect(first?.observed.segments).toEqual([
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
    ]);
    expect(session.meta.blocks.map((block) => [block.startLine, block.endLine])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('a message the runtime injected, or the summary after a compaction, opens no block', () => {
    const session = map([
      user('ask'),
      user('injected reminder', { isMeta: true }),
      base('system', { subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 9 } }),
      user('summary of before', { isCompactSummary: true }),
      assistant([{ type: 'text', text: 'after' }]),
    ]);
    expect(session.blocks).toHaveLength(1);
    const raw = session.blocks[0]?.observed.raw as ReplayRaw;
    expect(raw.markers.map((marker) => marker.kind)).toEqual(['compaction', 'compact_summary']);
    expect(raw.markers[0]).toMatchObject({ trigger: 'auto', preTokens: 9, afterToolCalls: 0, line: 3 });
    expect(raw.kept.map((entry) => entry.reason)).toEqual([
      'a message the runtime injected (isMeta)',
      'the summary after a compaction',
    ]);
  });
});

describe('mapSession: tool calls', () => {
  it('maps tool_use to a ToolCall and a segment, and its result to output, segment and latency', () => {
    const session = map([
      user('ask'),
      assistant([use('t1', 'Read', { file_path: `${CWD}/a.ts` })]),
      result('t1', 'file text'),
    ]);
    const observed = session.blocks[0]?.observed;
    expect(observed?.toolCalls).toEqual([
      {
        id: 't1',
        label: 'Read',
        input: { file_path: `${CWD}/a.ts` },
        startedAt: at(1),
        output: 'file text',
        latencyMs: 1000,
      },
    ]);
    expect(observed?.segments).toEqual([
      { type: 'tool_call', id: 't1', label: 'Read', input: { file_path: `${CWD}/a.ts` } },
      { type: 'tool_result', id: 't1', label: 'Read', output: 'file text' },
    ]);
    expect(session.meta.blocks[0]?.reads).toEqual([`${CWD}/a.ts`]);
  });

  it('an error result sets the call error, from a string or from text blocks', () => {
    const session = map([
      user('ask'),
      assistant([use('t1', 'Grep', { pattern: 'x' })]),
      result('t1', [{ type: 'text', text: 'no such path' }], {}, true),
    ]);
    const call = session.blocks[0]?.observed.toolCalls[0];
    expect(call?.error).toBe('no such path');
    expect(call?.output).toBeUndefined();
  });

  it('keeps the whole brief of an Agent call as its input', () => {
    const brief = {
      description: 'Review',
      subagent_type: 'reviewer',
      prompt: 'Owns: a.ts\nDone when: findings',
    };
    const session = map([user('ask'), assistant([use('t1', 'Agent', brief)]), result('t1', 'ok')]);
    expect(session.blocks[0]?.observed.toolCalls[0]?.input).toEqual(brief);
  });

  it('a Skill call is a skill load', () => {
    const session = map([
      user('ask'),
      assistant([use('t1', 'Skill', { skill: 'shop-build' })]),
      result('t1', 'ok'),
    ]);
    expect(session.blocks[0]?.observed.runtime?.skills).toEqual([{ name: 'shop-build', at: at(1) }]);
  });

  it('a call with no result stays, without output, and is named in the issues', () => {
    const session = map([user('ask'), assistant([use('t9', 'Bash', { command: 'sleep 1' })])]);
    expect(session.blocks[0]?.observed.toolCalls[0]).toMatchObject({ label: 'Bash' });
    expect(session.blocks[0]?.observed.executions).toEqual([]);
    expect(session.meta.issues).toEqual(['line 2: the Bash call t9 has no result']);
  });

  it('a result with no matching call is kept and named', () => {
    const session = map([user('ask'), result('ghost', 'x')]);
    expect((session.blocks[0]?.observed.raw as ReplayRaw | undefined)?.kept[0]?.reason).toBe(
      'a tool result with no matching call',
    );
    expect(session.meta.issues[0]).toContain('ghost');
  });
});

describe('mapSession: Bash executions', () => {
  const bash = (content: string, isError: boolean, structured?: Record<string, unknown>) =>
    map([
      user('ask'),
      assistant([use('b', 'Bash', { command: 'pnpm test' })]),
      result('b', content, structured ? { toolUseResult: structured } : {}, isError),
    ]).blocks[0]?.observed.executions?.[0];

  it('a success is exit code 0, with stdout from the structured result', () => {
    expect(bash('shown', false, { stdout: 'out', stderr: 'warn' })).toEqual({
      command: 'pnpm test',
      role: 'command',
      exitCode: 0,
      stdout: 'out',
      stderr: 'warn',
      startedAt: at(1),
      latencyMs: 1000,
    });
  });

  it('an error reads Exit code N, else 1', () => {
    expect(bash('Exit code 2\nboom', true)?.exitCode).toBe(2);
    expect(bash('boom', true)?.exitCode).toBe(1);
  });

  it('a structured exit code wins', () => {
    expect(bash('Exit code 2', true, { exitCode: 7 })?.exitCode).toBe(7);
  });

  it('a long output is cut and flagged', () => {
    const execution = bash('x'.repeat(5000), false);
    expect(execution?.stdout).toHaveLength(4000);
    expect(execution?.truncated).toBe(true);
  });
});

describe('mapSession: workspace diff', () => {
  it('derives created and changed from successful writes, relative to the session folder', () => {
    const session = map([
      user('ask'),
      assistant([use('r', 'Read', { file_path: `${CWD}/old.ts` })]),
      result('r', 'text'),
      assistant([use('w1', 'Write', { file_path: `${CWD}/old.ts`, content: '' })]),
      result('w1', 'ok'),
      assistant([use('w2', 'Write', { file_path: `${CWD}/new.ts`, content: '' })]),
      result('w2', 'ok'),
      assistant([use('w3', 'Write', { file_path: `${CWD}/told.ts`, content: '' })]),
      result('w3', 'ok', { toolUseResult: { type: 'update' } }),
      assistant([use('e1', 'Edit', { file_path: `${CWD}/new.ts` })]),
      result('e1', 'ok'),
      assistant([use('e2', 'Edit', { file_path: '/elsewhere/x.ts' })]),
      result('e2', 'ok'),
      assistant([use('e3', 'Edit', { file_path: `${CWD}/failed.ts` })]),
      result('e3', 'refused', {}, true),
    ]);
    expect(session.blocks[0]?.observed.workspaceDiff).toEqual({
      created: ['new.ts'],
      changed: ['old.ts', 'told.ts', '/elsewhere/x.ts'],
      deleted: [],
    });
    expect(session.meta.blocks[0]?.writes).toEqual([
      `${CWD}/old.ts`,
      `${CWD}/new.ts`,
      `${CWD}/told.ts`,
      `${CWD}/new.ts`,
      '/elsewhere/x.ts',
      `${CWD}/failed.ts`,
    ]);
  });

  it('a path created in an earlier block is changed in a later one', () => {
    const session = map([
      user('one'),
      assistant([use('w1', 'Write', { file_path: `${CWD}/a.ts` })]),
      result('w1', 'ok', { toolUseResult: { type: 'create' } }),
      user('two'),
      assistant([use('w2', 'Write', { file_path: `${CWD}/a.ts` })]),
      result('w2', 'ok'),
    ]);
    expect(session.blocks.map((block) => block.observed.workspaceDiff)).toEqual([
      { created: ['a.ts'], changed: [], deleted: [] },
      { created: [], changed: ['a.ts'], deleted: [] },
    ]);
  });

  it('with a before and after tree, the last block carries the diff of the trees', () => {
    const session = map([user('one'), user('two')], {
      trees: {
        before: { 'a.ts': '1', 'b.ts': '2', 'c.ts': '3' },
        after: { 'a.ts': '1', 'b.ts': '9', 'd.ts': '4' },
      },
    });
    const diff = { created: ['d.ts'], changed: ['b.ts'], deleted: ['c.ts'] };
    expect(session.blocks[1]?.observed.workspaceDiff).toEqual(diff);
    expect(session.blocks[0]?.observed.workspaceDiff).toEqual({ created: [], changed: [], deleted: [] });
    expect(session.meta.workspaceDiff).toEqual(diff);
  });

  it('diffTrees and treeOf read a folder by content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'replay-tree-'));
    try {
      await mkdir(join(dir, 'src'));
      await mkdir(join(dir, '.git'));
      await writeFile(join(dir, 'src', 'a.ts'), 'a');
      await writeFile(join(dir, '.git', 'HEAD'), 'x');
      const before = await treeOf(dir);
      expect(Object.keys(before)).toEqual(['src/a.ts']);
      await writeFile(join(dir, 'src', 'a.ts'), 'b');
      await writeFile(join(dir, 'new.txt'), 'n');
      expect(diffTrees(before, await treeOf(dir))).toEqual({
        created: ['new.txt'],
        changed: ['src/a.ts'],
        deleted: [],
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe('mapSession: usage, latency and kept records', () => {
  it('counts usage once per message id, with cache tokens as input', () => {
    clock = 0;
    const usage = { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 5 };
    const session = mapSession({
      transcript: lines([
        user('ask'),
        base('assistant', {
          message: { id: 'same', role: 'assistant', content: [{ type: 'text', text: 'a' }], usage },
        }),
        base('assistant', {
          message: { id: 'same', role: 'assistant', content: [{ type: 'text', text: 'b' }], usage },
        }),
      ]),
    });
    expect(session.blocks[0]?.observed.cost).toEqual({ inputTokens: 15, outputTokens: 3 });
    expect(session.blocks[0]?.observed.latencyMs).toBe(2000);
  });

  it('keeps every record it does not map: unknown types, thinking, helpers, preamble, bad lines', () => {
    const session = map([
      { type: 'summary', summary: 'A title', leafUuid: 'x' },
      { type: 'queue-operation', operation: 'enqueue' },
      user('ask'),
      { type: 'file-history-snapshot', snapshot: {} },
      assistant([
        { type: 'thinking', thinking: 'hm' },
        { type: 'text', text: 'ok' },
      ]),
      base('assistant', { isSidechain: true, message: { content: [use('s1', 'Read', { file_path: 'x' })] } }),
      base('system', { subtype: 'informational', content: 'note' }),
      'this is not json',
    ]);
    expect(session.meta.summaries).toEqual(['A title']);
    expect(session.meta.preamble.map((entry) => entry.reason)).toEqual(['a record of type queue-operation']);
    const raw = session.blocks[0]?.observed.raw as ReplayRaw;
    expect(raw.kept.map((entry) => entry.reason)).toEqual([
      'a record of type file-history-snapshot',
      'a thinking block',
      'a helper record (sidechain)',
      'a system record',
      expect.stringMatching(/^not JSON: /),
    ]);
    expect(session.blocks[0]?.observed.toolCalls).toEqual([]);
    expect(session.meta.issues).toEqual([expect.stringMatching(/^line 8 is not JSON/)]);
  });
});

describe('mapSession: guard decisions and steps', () => {
  const transcript = [user('one'), assistant([{ type: 'text', text: 'a' }]), user('two')];

  it('places each row in the block whose window holds it; an early row goes to the first block', () => {
    const decisions = lines([
      { at: at(1), event: 'PreToolUse', check: 'gate', verdict: 'allow', session: SID },
      { at: at(5), event: 'Stop', check: 'gate', verdict: 'deny' },
      { at: '2025-12-31T00:00:00.000Z', event: 'UserPromptSubmit', check: 'early', verdict: 'allow' },
      { at: at(1), check: 'other', verdict: 'deny', session: 'another-session' },
      { at: 'not a time', check: 'broken', verdict: 'allow' },
    ]);
    const steps = lines([{ at: at(0), step: 'plan' }, { at: at(3), step: 'report' }, { step: 'no time' }]);
    const session = map(transcript, { decisions, steps });
    expect(session.blocks.map((block) => block.observed.runtime?.guards)).toEqual([
      [
        { name: 'early', verdict: 'allow', at: '2025-12-31T00:00:00.000Z' },
        { name: 'gate', verdict: 'allow', at: at(1) },
      ],
      [{ name: 'gate', verdict: 'deny', at: at(5) }],
    ]);
    expect(session.blocks.map((block) => block.observed.runtime?.stages)).toEqual([
      [{ name: 'plan', at: at(0) }],
      [{ name: 'report', at: at(3) }],
    ]);
    expect(session.meta.issues).toEqual(['1 decision-log rows belong to another session and were left out']);
    expect(session.meta.unplaced.guards.map((entry) => entry.reason)).toEqual(['the row has no valid at']);
    expect(session.meta.unplaced.stages.map((entry) => entry.reason)).toEqual(['the row has no valid at']);
  });

  it('without a decision log or step feed the trace has no guards or stages', () => {
    const runtime = map(transcript).blocks[0]?.observed.runtime;
    expect(runtime).toEqual({ skills: [], references: [], subagents: [] });
  });
});

describe('the fixture sessions', () => {
  const names = [
    'clean-build',
    'skill-skipped',
    'forbidden-act',
    'gate-violated',
    'compaction-mid-task',
    'subagent-dispatch',
  ];

  it.each(names)('%s maps to Observed blocks that validate, with no issue', async (name) => {
    const file = (suffix: string) => join(SESSIONS, `${name}${suffix}`);
    const { existsSync } = await import('node:fs');
    const session = await readSession({
      transcript: file('.jsonl'),
      ...(existsSync(file('.decisions.jsonl')) ? { decisions: file('.decisions.jsonl') } : {}),
      ...(existsSync(file('.steps.jsonl')) ? { steps: file('.steps.jsonl') } : {}),
    });
    expect(session.blocks.length).toBeGreaterThan(0);
    expect(session.meta.issues).toEqual([]);
    for (const block of session.blocks) {
      expect(Observed.safeParse(JSON.parse(JSON.stringify(block.observed))).success).toBe(true);
    }
  });

  it('the helper records of the dispatch session are kept, not counted as the agent calls', async () => {
    const session = await readSession({ transcript: join(SESSIONS, 'subagent-dispatch.jsonl') });
    expect(session.blocks[0]?.observed.toolCalls.map((call) => call.label)).toEqual(['Skill', 'Agent']);
  });

  it('readSession refuses a before tree without an after tree', async () => {
    await expect(
      readSession({ transcript: join(SESSIONS, 'clean-build.jsonl'), before: SESSIONS }),
    ).rejects.toThrow('a before tree needs an after tree');
  });
});

afterEach(() => {
  clock = 0;
});

describe('D8: a file that is not a transcript is refused', () => {
  it('refuses another JSONL shape, naming the keys of its first line', () => {
    const other = parseJsonl(JSON.stringify({ id: 'conv-1', turns: [{ role: 'user', text: 'hello' }] }));
    expect(() => mapSession({ transcript: other, file: 'conv.jsonl' })).toThrow(NotATranscriptError);
    expect(() => mapSession({ transcript: other, file: 'conv.jsonl' })).toThrow(
      'conv.jsonl is not a Claude Code transcript: no record has type user or assistant (line 1 has the keys id, turns)',
    );
  });

  it('refuses an empty file and a file of lines that are not JSON', () => {
    expect(() => mapSession({ transcript: [] })).toThrow('it holds no record');
    expect(() => mapSession({ transcript: parseJsonl('nope') })).toThrow('line 1 is not JSON');
  });

  it('accepts a transcript whose only turn record is a user record', () => {
    expect(map([user('just a question')]).blocks).toHaveLength(1);
  });
});
