import { join } from 'node:path';
import {
  AdapterTransportError,
  type AgentAdapter,
  AgentFailure,
  type Observed,
} from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  applySessionOps,
  type ClaudeCodeLiveOptions,
  claudeCodeLiveAdapter,
  type LiveOp,
  loadStateLibrary,
  opsForTurn,
  type StateLibrary,
} from '../../../src/claude-code/live';
import {
  ASK_INVOICE,
  ASK_WEEKLY,
  callsOf,
  ESTATE,
  FAKE,
  FAKE_RECORDINGS,
  givenOf,
  MAP_HASH,
  RUNTIME_FLAGS,
  STATES,
  scratch,
  turnOf,
} from './support';

// Each test starts sandboxes and processes; under a full parallel suite that takes more than the default.
vi.setConfig({ testTimeout: 60_000 });

/**
 * Session states and estate deviations as runner operations, each run on the FAKE headless command: what
 * the fake found when the turn started is in its call log, and what the runner did is in `raw.live`.
 */

let library: StateLibrary;
beforeAll(async () => {
  library = await loadStateLibrary(STATES);
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function run(
  vars: Record<string, unknown>,
  asks: string[] = [ASK_INVOICE],
  extra: Partial<ClaudeCodeLiveOptions> = {},
): Promise<{ observed: Observed[]; calls: Array<Record<string, unknown>>; adapter: AgentAdapter }> {
  const work = await scratch();
  cleanups.push(work.done);
  const adapter = claudeCodeLiveAdapter({
    command: FAKE,
    estateRoot: ESTATE,
    provider: localProvider({ dir: join(work.dir, 'sandboxes') }),
    stateDir: join(work.dir, 'state'),
    env: { ...FAKE_RECORDINGS, FAKE_CALLS: work.calls },
    retries: { max: 3, backoffMs: 0 },
    pins: [MAP_HASH],
    library,
    config: 'isolated',
    ...extra,
  });
  const given = givenOf(vars);
  const session = await adapter.open(given);
  const observed: Observed[] = [];
  try {
    for (const [index, ask] of asks.entries())
      observed.push(await adapter.send(session, turnOf(index, ask, given)));
  } finally {
    await adapter.close(session);
  }
  return { observed, calls: await callsOf(work.calls), adapter };
}

async function goneWithin(pid: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    if (Date.now() > end) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function live(observed: Observed | undefined): Record<string, unknown> {
  if (observed === undefined) throw new Error('no block was observed');
  return (observed.raw as { live: Record<string, unknown> }).live;
}

describe('session states on the fake command', () => {
  it('fresh: no session file, no resume', async () => {
    const { calls, observed } = await run({ session_state: 'fresh' });
    expect(calls[0]?.resume).toBeNull();
    expect(live(observed[0]).ops).toEqual([]);
  });

  it('resumed: the recorded prefix is the session file the turn resumes, fitted to the sandbox', async () => {
    const { calls, observed } = await run({ session_state: 'resumed' });
    const argv = calls[0]?.argv as string[];
    expect(argv.slice(-2)[0]).toBe('--resume');
    expect(calls[0]?.found).toBe(true);
    expect(calls[0]?.records).toBe(4);
    expect(calls[0]?.torn).toBe(false);
    expect(live(observed[0]).ops).toEqual(['resume', 'plant']);
    // The prefix is not part of the turn: the block holds the ask's own calls only.
    expect(observed[0]?.toolCalls.map((call) => call.label)).toEqual(['Skill', 'Read', 'Read', 'Read']);
  });

  it('long: a prefix of six earlier turns', async () => {
    const { calls } = await run({ session_state: 'long' });
    expect(calls[0]?.records).toBe(12);
  });

  it('after compaction: a compaction boundary and its summary are in the file the turn resumes', async () => {
    const { calls, observed } = await run({ session_state: 'after_compaction' });
    expect(calls[0]?.compacted).toBe(true);
    expect(calls[0]?.records).toBe(14);
    expect(live(observed[0]).notes).toContain('compact: a compaction boundary and its summary were appended');
  });

  it('marks a planted compaction in the trace, at the start of the turn, so a hazard check can read it', async () => {
    // Seen on the Cue bench: the runtime does not stream a boundary it found in the file it resumed.
    const { observed } = await run({ session_state: 'long', event: 'compaction_mid_task' });
    const raw = observed[0]?.raw as { markers: Array<Record<string, unknown>> };
    expect(raw.markers).toEqual([
      expect.objectContaining({
        kind: 'compaction',
        afterToolCalls: 0,
        planted: true,
        trigger: 'auto',
        preTokens: 150000,
      }),
    ]);
    const fresh = await run({});
    const freshRaw = fresh.observed[0]?.raw as { markers: unknown[] } | undefined;
    expect(freshRaw?.markers).toEqual([]);
  });

  it('after restart: the session file is cut with a torn record and reopened', async () => {
    const { calls, observed } = await run({ session_state: 'after_restart' });
    expect(calls[0]?.torn).toBe(true);
    expect(calls[0]?.records).toBe(3);
    expect(live(observed[0]).notes).toContain(
      'restart: the session was cut after 3 records, the next one torn',
    );
  });

  it('a mid-turn message: queued on the input before the reply ends, kept in the same block', async () => {
    const queued = 'Also, keep it short please.';
    const { calls, observed } = await run({ mid_turn: queued });
    expect(calls[0]?.argv).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      ...RUNTIME_FLAGS,
    ]);
    expect(calls[0]?.ask).toBe(ASK_INVOICE);
    expect(calls[0]?.queued).toEqual([queued]);
    expect(observed).toHaveLength(1);
    const raw = observed[0]?.raw as {
      kept: Array<{ reason: string; record: { message: { content: string } } }>;
    };
    const injected = raw.kept.filter((entry) => entry.reason.includes('injected'));
    expect(injected.map((entry) => entry.record.message.content)).toEqual([queued]);
    expect(live(observed[0]).queued).toEqual([queued]);
  });

  it('a planted file: written into the workspace before the turn, not counted as the agent change', async () => {
    const { observed, calls } = await run({ session_state: 'resumed', event: 'stale_tracker' }, [
      ASK_INVOICE,
    ]);
    expect(calls[0]?.played).toBe('recorded');
    expect(observed[0]?.workspaceDiff).toEqual({ created: [], changed: [], deleted: [] });
    expect(live(observed[0]).notes).toEqual(expect.arrayContaining(['plant: tracker/open.md']));
  });

  it('a dead helper: its dispatch and own record are in the session file, its process is gone', async () => {
    const { calls, observed } = await run({ session_state: 'resumed', event: 'dead_helper' });
    expect(calls[0]?.pendingHelpers).toBe(1);
    const helpers = calls[0]?.helpers as Array<{ id: string; alive: boolean }>;
    expect(helpers.map(({ id, alive }) => ({ id, alive }))).toEqual([{ id: 'helper-1', alive: false }]);
    expect(live(observed[0]).ops).toEqual(['resume', 'plant', 'helper']);
  });

  it('helpers running: the helper is alive while the turn runs, and stopped at close', async () => {
    const { calls } = await run({ session_state: 'helpers_running' });
    const helpers = calls[0]?.helpers as Array<{ id: string; pid: number; alive: boolean }>;
    expect(helpers.map(({ id, alive }) => ({ id, alive }))).toEqual([{ id: 'helper-1', alive: true }]);
    const pid = helpers[0]?.pid ?? 0;
    expect(await goneWithin(pid, 2000)).toBe(true);
  });

  it('a rate wave: the fake answers overloaded twice, the runner retries and the third attempt serves', async () => {
    const { observed, calls } = await run({ event: 'rate_wave' }, [ASK_WEEKLY]);
    expect(calls.map((call) => call.overloaded === true)).toEqual([true, true, false]);
    expect(live(observed[0]).attempts).toEqual([
      { exitCode: 1, overloaded: true },
      { exitCode: 1, overloaded: true },
      { exitCode: 0, overloaded: false },
    ]);
    expect(observed[0]?.workspaceDiff?.changed).toEqual(['reports/2026-W41.md']);
  });

  it('a rate wave longer than the retries fails the turn as a transport error', async () => {
    const wave: LiveOp[] = [{ op: 'rate_wave', overloads: 5 }];
    await expect(
      run({}, [ASK_INVOICE], { ops: (turn) => (turn.index === 0 ? wave : []) }),
    ).rejects.toBeInstanceOf(AdapterTransportError);
  });

  it('applies an event once, at the first turn that names it', async () => {
    const { observed } = await run({ session_state: 'long', event: 'process_restart' }, [
      ASK_INVOICE,
      ASK_INVOICE,
    ]);
    expect(live(observed[0]).ops).toEqual(['resume', 'restart']);
    expect(live(observed[1]).ops).toEqual([]);
  });

  it('refuses a state the library does not hold, instead of running fresh', async () => {
    await expect(run({ session_state: 'underwater' })).rejects.toBeInstanceOf(AgentFailure);
  });
});

describe('the operations, alone', () => {
  const context = {
    newId: () => 'session-1',
    cwd: '/w',
    at: '2026-10-12T10:00:00.000Z',
    helperId: () => 'helper-9',
  };
  const prefix = [
    { type: 'user', uuid: 'a', message: { role: 'user', content: 'Open {{cwd}}/x' } },
    {
      type: 'assistant',
      uuid: 'b',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    },
  ];

  it('fits a prefix to the folder and the session id', () => {
    const { file } = applySessionOps(undefined, [{ op: 'resume', prefix }], context);
    expect(file?.id).toBe('session-1');
    expect(file?.records[0]).toMatchObject({
      sessionId: 'session-1',
      cwd: '/w',
      message: { content: 'Open /w/x' },
    });
  });

  it('cuts a restart after keep records and tears the next', () => {
    const { file } = applySessionOps(undefined, [{ op: 'restart', prefix, keep: 1 }], context);
    expect(file?.records).toHaveLength(1);
    expect(file?.torn).toBeDefined();
    expect(() => JSON.parse(file?.torn ?? '')).toThrow();
  });

  it('appends the compaction boundary before its summary', () => {
    const { file } = applySessionOps(undefined, [{ op: 'compact', prefix, summary: 'So far.' }], context);
    expect(file?.records.slice(-2).map((record) => record.subtype ?? record.isCompactSummary)).toEqual([
      'compact_boundary',
      true,
    ]);
  });

  it('notes a compaction or a restart with no session before the turn', () => {
    const { file, notes } = applySessionOps(
      undefined,
      [{ op: 'compact', summary: 'x' }, { op: 'restart' }],
      context,
    );
    expect(file).toBeUndefined();
    expect(notes).toEqual([
      'compact: no session before the turn, nothing to compact',
      'restart: no session before the turn, nothing to cut',
    ]);
  });

  it('reads the session state at the first turn only, and the fallback when vars name none', () => {
    const applied = new Set<string>();
    const fallback: LiveOp[] = [{ op: 'queue', message: 'x' }];
    expect(opsForTurn(library, { session_state: 'long' }, 0, applied).map((op) => op.op)).toEqual(['resume']);
    expect(opsForTurn(library, { session_state: 'long' }, 1, applied)).toEqual([]);
    expect(opsForTurn(library, {}, 0, new Set(), fallback)).toEqual(fallback);
  });
});
