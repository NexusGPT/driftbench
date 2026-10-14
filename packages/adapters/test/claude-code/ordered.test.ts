import {
  AgentFailure,
  type BlockResult,
  type CheckContext,
  type Message,
  type Observed,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { mapSession, orderedCheck, parseJsonl, replayAdapter } from '../../src/claude-code';

type Call = { label: string; input?: Record<string, unknown>; at?: string };

function observed(calls: Call[], extra: Partial<Observed> = {}): Observed {
  return {
    segments: [],
    text: '',
    toolCalls: calls.map((call, index) => ({
      id: `c${index}`,
      label: call.label,
      input: call.input ?? {},
      ...(call.at ? { startedAt: call.at } : {}),
    })),
    cost: {},
    latencyMs: 0,
    ...extra,
  };
}

function context(current: Observed, history: Observed[] = []): CheckContext {
  return {
    blockIndex: history.length,
    observed: current,
    history: history.map((entry, index) => ({ index, observed: entry }) as unknown as BlockResult),
  } as unknown as CheckContext;
}

const read = (path: string): Call => ({ label: 'Read', input: { file_path: path } });
const edit = (path: string): Call => ({ label: 'Edit', input: { file_path: path } });
const pair = { before: 'Read', after: 'Edit', key: 'file_path' };

describe('orderedCheck', () => {
  it('passes when every after has its before, here or in an earlier block', () => {
    const verdicts = orderedCheck(
      context(observed([edit('a'), read('b'), edit('b')]), [observed([read('a')])]),
      pair,
    );
    expect(verdicts).toEqual([
      expect.objectContaining({ id: 'ordered.Read.Edit', outcome: 'pass', gating: true, kind: 'machine' }),
    ]);
  });

  it('fails when the after comes first, and names it', () => {
    const [verdict] = orderedCheck(context(observed([edit('a'), read('a')])), pair);
    expect(verdict?.outcome).toBe('fail');
    expect(verdict?.evidence).toContain('Edit a (block 0, call 1)');
  });

  it('with a key, a before on another value does not count', () => {
    expect(orderedCheck(context(observed([read('b'), edit('a')])), pair)[0]?.outcome).toBe('fail');
    expect(
      orderedCheck(context(observed([read('b'), edit('a')])), { before: 'Read', after: 'Edit' })[0]?.outcome,
    ).toBe('pass');
  });

  it('with reset: compaction, a before ahead of a compaction does not count', () => {
    const compacted = observed([edit('a')], {
      raw: {
        runtime: 'claude-code',
        markers: [{ kind: 'compaction', line: 1, afterToolCalls: 0 }],
        kept: [],
      },
    });
    const history = [observed([read('a')])];
    expect(orderedCheck(context(compacted, history), { ...pair, reset: 'compaction' })[0]?.outcome).toBe(
      'fail',
    );
    expect(orderedCheck(context(compacted, history), pair)[0]?.outcome).toBe('pass');
  });

  it('matches skills by skill:<name> and stages by stage:<name>, stages placed by time', () => {
    const skill = observed([{ label: 'Skill', input: { skill: 'build' } }, edit('a')]);
    expect(orderedCheck(context(skill), { before: 'skill:build', after: 'Edit' })[0]?.outcome).toBe('pass');
    expect(orderedCheck(context(skill), { before: 'skill:other', after: 'Edit' })[0]?.outcome).toBe('fail');
    const staged = observed(
      [
        { label: 'Read', at: '2026-01-01T00:00:01Z' },
        { label: 'Edit', at: '2026-01-01T00:00:03Z' },
      ],
      { runtime: { stages: [{ name: 'build', at: '2026-01-01T00:00:02Z' }] } },
    );
    expect(orderedCheck(context(staged), { before: 'stage:build', after: 'Edit' })[0]?.outcome).toBe('pass');
    expect(orderedCheck(context(staged), { before: 'stage:build', after: 'Read' })[0]?.outcome).toBe('fail');
  });

  it('says nothing for a pair whose after does not occur, and takes several pairs', () => {
    const verdicts = orderedCheck(context(observed([read('a')])), {
      pairs: [pair, { before: 'Edit', after: 'Read' }],
    });
    expect(verdicts.map((verdict) => [verdict.id, verdict.outcome])).toEqual([['ordered.Edit.Read', 'fail']]);
  });

  it('D12: a successful Write of the file counts as its Read, a failed one does not', () => {
    const write = (path: string, error?: string): Call & { error?: string } => ({
      label: 'Write',
      input: { file_path: path },
      ...(error ? { error } : {}),
    });
    const ok = observed([write('a'), edit('a')]);
    expect(orderedCheck(context(ok), pair)[0]?.outcome).toBe('pass');
    expect(orderedCheck(context(observed([write('b'), edit('a')])), pair)[0]?.outcome).toBe('fail');
    const failed = observed([edit('a')]);
    failed.toolCalls.unshift({ id: 'w', label: 'Write', input: { file_path: 'a' }, error: 'refused' });
    expect(orderedCheck(context(failed), pair)[0]?.outcome).toBe('fail');
  });

  it('D12: before takes a list, any one of which holds the pair', () => {
    const verdicts = orderedCheck(
      context(observed([{ label: 'Grep', input: { file_path: 'a' } }, edit('a')])),
      {
        before: ['Read', 'Grep'],
        after: 'Edit',
        key: 'file_path',
      },
    );
    expect(verdicts.map((verdict) => [verdict.id, verdict.outcome])).toEqual([
      ['ordered.Read_or_Grep.Edit', 'pass'],
    ]);
    expect(() => orderedCheck(context(observed([])), { before: [], after: 'Edit' })).toThrow('needs before');
    expect(() => orderedCheck(context(observed([])), { before: ['Read', 3], after: 'Edit' })).toThrow(
      'needs before',
    );
  });

  it('refuses options it cannot read', () => {
    expect(() => orderedCheck(context(observed([])), { before: 'Read' })).toThrow('needs before');
    expect(() => orderedCheck(context(observed([])), { ...pair, reset: 'restart' })).toThrow(
      'reset takes only',
    );
    expect(() => orderedCheck(context(observed([])), { ...pair, key: 3 })).toThrow('key is a field name');
  });
});

describe('replayAdapter', () => {
  const session = mapSession({
    transcript: parseJsonl(
      [
        { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'one' } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } },
        { type: 'user', timestamp: '2026-01-01T00:00:05Z', message: { content: 'two' } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'second' }] } },
      ]
        .map((record) => JSON.stringify(record))
        .join('\n'),
    ),
  });

  it('rejects sparse and accessor history arrays at open and send', async () => {
    const adapter = replayAdapter({ session });
    const given = {
      prefix: [] as Message[],
      ledger: {},
      world: {},
      vars: {},
      target: { adapter: 'claude-code' },
      hash: 'h',
    };
    const open = await adapter.open(given);
    let reads = 0;
    const accessor = Object.defineProperty([], '0', {
      enumerable: true,
      get: () => {
        reads++;
        return { role: 'user', content: 'before' };
      },
    });
    for (const prefix of [new Array(1), accessor]) {
      await expect(adapter.open({ ...given, prefix })).rejects.toThrow(/history\[0\]/);
      open.history = prefix;
      await expect(adapter.send(open, { index: 0, stimulus: { user: 'one' }, given })).rejects.toThrow(
        /history\[0\]/,
      );
    }
    expect(reads).toBe(0);
    await adapter.close(open);
  });

  it('rejects accessor messages without reading them', async () => {
    let reads = 0;
    const adapter = replayAdapter({ session });
    await expect(
      adapter.open({
        prefix: [
          {
            role: 'user',
            get content() {
              reads++;
              return 'before';
            },
          },
        ],
        ledger: {},
        world: {},
        vars: {},
        target: { adapter: 'claude-code' },
        hash: 'h',
      }),
    ).rejects.toThrow(/content.*accessor/);
    expect(reads).toBe(0);
  });

  it('serves block fromBlock + k for the spec block k, and fails past the end', async () => {
    const adapter = replayAdapter({ session, fromBlock: 1 });
    expect(adapter.capabilities().deterministic).toBe(true);
    const given = {
      prefix: [{ role: 'user', content: 'prefix' }] as Message[],
      ledger: {},
      world: {},
      vars: {},
      target: { adapter: 'claude-code' },
      hash: 'h',
    };
    const open = await adapter.open(given);
    expect(open.history).not.toBe(given.prefix);
    expect(open.history[0]).toBe(given.prefix[0]);
    expect(() => {
      (given.prefix[0] as Message).content = 'changed';
    }).toThrow(TypeError);
    const added: Message = { role: 'user', content: 'new' };
    open.history.push(added);
    const turn = (index: number) => ({ index, stimulus: { user: 'two' }, given });
    expect((await adapter.send(open, turn(0))).text).toBe('second');
    expect(Object.isFrozen(added)).toBe(true);
    await expect(adapter.send(open, turn(1))).rejects.toBeInstanceOf(AgentFailure);
    await expect(adapter.send(open, turn(1))).rejects.toThrow('the session has 2 blocks');
    await adapter.close(open);
  });

  it('refuses a negative first block', () => {
    expect(() => replayAdapter({ session, fromBlock: -1 })).toThrow('fromBlock');
  });
});

describe('orderedCheck with an end anchored on what a call holds', () => {
  const bash = (command: string): Call => ({ label: 'Bash', input: { command } });
  const pair = { before: 'Bash~git status', after: 'Bash~commit' };

  it('tells two calls of one tool apart by their command: git status before git commit', () => {
    expect(orderedCheck(context(observed([bash('git status'), bash('git commit -m x')])), pair)).toEqual([
      expect.objectContaining({ id: 'ordered.Bash_git_status.Bash_commit', outcome: 'pass' }),
    ]);
    expect(orderedCheck(context(observed([bash('ls'), bash('git commit -m x')])), pair)[0]?.outcome).toBe(
      'fail',
    );
    expect(
      orderedCheck(context(observed([bash('git commit -m x'), bash('git status')])), pair)[0]?.outcome,
    ).toBe('fail');
  });

  it('says nothing when no call holds the after end, and reads a file path too', () => {
    expect(orderedCheck(context(observed([bash('git status'), bash('ls')])), pair)).toEqual([]);
    const read = { before: 'Read~rules.md', after: 'Edit' };
    expect(
      orderedCheck(
        context(observed([{ label: 'Read', input: { file_path: '/w/refs/rules.md' } }, edit('a')])),
        read,
      )[0]?.outcome,
    ).toBe('pass');
  });
});
