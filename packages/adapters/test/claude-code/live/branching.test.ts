import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message, ResolvedGiven, Sandbox, Session } from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ClaudeCodeLiveOptions,
  claudeCodeLiveAdapter,
  loadStateLibrary,
  type StateLibrary,
} from '../../../src/claude-code/live';
import { recordsOfMessages } from '../../../src/claude-code/live/states';
import {
  ASK_INVOICE,
  ASK_WEEKLY,
  callsOf,
  ESTATE,
  FAKE,
  FAKE_RECORDINGS,
  givenOf,
  MAP_HASH,
  SEED,
  STATES,
  scratch,
  turnOf,
} from './support';

vi.setConfig({ testTimeout: 60_000 });

/**
 * Blocks that start from another block's end state, on the live runner against the FAKE headless command of
 * the Northwind fixture: no model call. The earlier turns of a conversation become the session file the first
 * turn resumes, and the workspace the agent left goes to the continuation.
 */

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function setup(extra: Partial<ClaudeCodeLiveOptions> = {}) {
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
    config: 'isolated',
    ...extra,
  });
  return { adapter, work };
}

const EARLIER: Message[] = [
  { role: 'user', content: 'Where is shipment NW-55031?' },
  { role: 'assistant', content: 'NW-55031 is with FRT, promised for 2026-10-03, not delivered yet.' },
];

function sandboxOf(session: Session): Sandbox {
  return (session.state as { sandbox: Sandbox }).sandbox;
}

async function textOf(session: Session, path: string): Promise<string> {
  return new TextDecoder().decode(await sandboxOf(session).readFile(path));
}

function liveOps(observed: { raw?: unknown } | undefined): string[] {
  const raw = observed?.raw as { live?: { ops?: string[] } } | undefined;
  return raw?.live?.ops ?? [];
}

describe('branching', () => {
  it('is off by default: no seeded history, no end state to hand on', async () => {
    const { adapter } = await setup();
    expect(adapter.capabilities().seedPrefix).toBe(false);
    expect(adapter.snapshotGiven).toBeUndefined();
  });

  it('seeds the earlier turns as the session the first turn resumes', async () => {
    const { adapter, work } = await setup({ branching: true });
    expect(adapter.capabilities().seedPrefix).toBe(true);
    const given: ResolvedGiven = { ...givenOf(), prefix: EARLIER };
    const session = await adapter.open(given);
    cleanups.push(() => adapter.close(session));
    await adapter.send(session, turnOf(0, ASK_WEEKLY, given));
    const [call] = await callsOf(work.calls);
    expect(call?.resume).not.toBeNull();
    expect(call?.found).toBe(true);
    // The two earlier turns are in the file the runtime resumed, before the turn's own records.
    expect(call?.records).toBe(2);
  });

  it('resumes nothing when the Given carries no earlier turn', async () => {
    const { adapter, work } = await setup({ branching: true });
    const given = givenOf();
    const session = await adapter.open(given);
    cleanups.push(() => adapter.close(session));
    await adapter.send(session, turnOf(0, ASK_WEEKLY, given));
    expect((await callsOf(work.calls))[0]?.resume).toBeNull();
  });

  it('hands the workspace the agent left to the continuation, without the unchanged estate files', async () => {
    const { adapter, work } = await setup({ branching: true });
    const given = givenOf();
    const parent = await adapter.open(given);
    cleanups.push(() => adapter.close(parent));
    await adapter.send(parent, turnOf(0, ASK_WEEKLY, given));
    const end = await adapter.snapshotGiven?.(parent);
    const files = (end?.world.workspace?.files ?? {}) as Record<string, string>;
    // The agent edited the report; the seed files stay; the files of the estate copy did not change, so they are out.
    expect(files['reports/2026-W41.md']).toBeDefined();
    expect(files['reports/2026-W41.md']).not.toBe(SEED['reports/2026-W41.md']);
    expect(files['ledger/2026-W41.csv']).toBe(SEED['ledger/2026-W41.csv']);
    expect(Object.keys(files).filter((path) => path === 'CLAUDE.md' || path.startsWith('.claude/'))).toEqual(
      [],
    );

    // A continuation opened from that end state and the earlier turns finds the edited report and resumes the turns.
    const child: ResolvedGiven = { ...givenOf(), world: end?.world ?? {}, prefix: EARLIER };
    const next = await adapter.open(child);
    cleanups.push(() => adapter.close(next));
    const report = new TextDecoder().decode(await sandboxOf(next).readFile('reports/2026-W41.md'));
    expect(report).toBe(files['reports/2026-W41.md']);
    await adapter.send(next, turnOf(0, ASK_INVOICE, child));
    const calls = await callsOf(work.calls);
    expect(calls.at(-1)?.records).toBe(2);
  });

  it('two continuations of one parent do not see each other', async () => {
    const { adapter } = await setup({ branching: true });
    const given = givenOf();
    const parent = await adapter.open(given);
    cleanups.push(() => adapter.close(parent));
    await adapter.send(parent, turnOf(0, ASK_WEEKLY, given));
    const end = await adapter.snapshotGiven?.(parent);
    const child: ResolvedGiven = { ...givenOf(), world: end?.world ?? {}, prefix: EARLIER };
    const a = await adapter.open(child);
    const b = await adapter.open(child);
    cleanups.push(
      () => adapter.close(a),
      () => adapter.close(b),
    );
    await sandboxOf(a).seed({ files: { 'notes/only-a.txt': 'a' } });
    expect(await sandboxOf(b).listFiles()).not.toContain('notes/only-a.txt');
  });

  it('a continuation resumes the parent conversation, not the library session it inherited', async () => {
    const library: StateLibrary = await loadStateLibrary(STATES);
    const { adapter, work } = await setup({ branching: true, library });
    const given = givenOf({ session_state: 'resumed', event: 'stale_tracker', mid_turn: 'Keep the notes.' });
    const parent = await adapter.open(given);
    cleanups.push(() => adapter.close(parent));
    await adapter.send(parent, turnOf(0, ASK_WEEKLY, given));
    // The parent already applied the library resume and the planted tracker. What it leaves is the continuation.
    await writeFile(join(sandboxOf(parent).root, 'tracker/open.md'), 'parent kept its tracker\n');
    const end = await adapter.snapshotGiven?.(parent);
    expect(end?.vars.session_state).toBe('fresh');
    expect(end?.vars.mid_turn).toBeUndefined();
    expect(end?.vars.event).toBeUndefined();
    expect(end?.vars.workspace_seed).toBe('northwind-ops');
    expect(end?.vars.estate).toEqual(given.vars.estate);

    const child: ResolvedGiven = {
      ...givenOf(),
      world: end?.world ?? {},
      vars: end?.vars ?? {},
      prefix: EARLIER,
    };
    const next = await adapter.open(child);
    cleanups.push(() => adapter.close(next));
    expect(await textOf(next, 'tracker/open.md')).toBe('parent kept its tracker\n');
    const observed = await adapter.send(next, turnOf(0, ASK_INVOICE, child));
    // Turn 0 of the new session would have looked the inherited state and event up again.
    expect(liveOps(observed)).toEqual(['resume']);
    expect(await textOf(next, 'tracker/open.md')).toBe('parent kept its tracker\n');
    const calls = await callsOf(work.calls);
    expect(calls.at(-1)?.records).toBe(2);
  });

  it('a continuation does not reapply the adapter fallback session state', async () => {
    const library = await loadStateLibrary(STATES);
    const { adapter, work } = await setup({ branching: true, sessionState: library.states.long });
    const given = givenOf();
    const parent = await adapter.open(given);
    cleanups.push(() => adapter.close(parent));
    await adapter.send(parent, turnOf(0, ASK_WEEKLY, given));
    expect((await callsOf(work.calls))[0]?.records).toBe(12);
    const end = await adapter.snapshotGiven?.(parent);
    const child: ResolvedGiven = {
      ...givenOf(),
      world: end?.world ?? {},
      vars: end?.vars ?? {},
      prefix: EARLIER,
    };
    const next = await adapter.open(child);
    cleanups.push(() => adapter.close(next));
    await adapter.send(next, turnOf(0, ASK_INVOICE, child));
    expect((await callsOf(work.calls)).at(-1)?.records).toBe(2);
  });

  it('a named session state still begins the session, ahead of a written prefix', async () => {
    const library = await loadStateLibrary(STATES);
    const { adapter, work } = await setup({ branching: true, library });
    const given: ResolvedGiven = { ...givenOf({ session_state: 'long' }), prefix: EARLIER };
    const session = await adapter.open(given);
    cleanups.push(() => adapter.close(session));
    await adapter.send(session, turnOf(0, ASK_WEEKLY, given));
    // The library prefix is twelve records; the two written turns are not what the runtime resumed.
    expect((await callsOf(work.calls))[0]?.records).toBe(12);
  });

  it('a file only the adapter seed supplied stays deleted on a continuation', async () => {
    const { adapter } = await setup({
      branching: true,
      workspace: {
        files: {
          'notes/adapter-only.txt': 'from the adapter',
          'notes/kept.txt': 'still here',
        },
      },
    });
    const given = givenOf();
    const parent = await adapter.open(given);
    cleanups.push(() => adapter.close(parent));
    expect(await textOf(parent, 'notes/adapter-only.txt')).toBe('from the adapter');
    await rm(join(sandboxOf(parent).root, 'notes/adapter-only.txt'));
    const end = await adapter.snapshotGiven?.(parent);
    expect(end?.vars.deleted_seed).toEqual(['notes/adapter-only.txt']);
    expect(end?.world.workspace?.files?.['notes/kept.txt']).toBe('still here');
    expect(end?.world.workspace?.files?.['notes/adapter-only.txt']).toBeUndefined();

    const child: ResolvedGiven = { ...givenOf(), world: end?.world ?? {}, vars: end?.vars ?? {} };
    const next = await adapter.open(child);
    cleanups.push(() => adapter.close(next));
    const files = await sandboxOf(next).listFiles();
    expect(files).not.toContain('notes/adapter-only.txt');
    expect(await textOf(next, 'notes/kept.txt')).toBe('still here');
    expect(await textOf(next, 'ledger/2026-W41.csv')).toBe(SEED['ledger/2026-W41.csv']);

    // A fresh session still receives the adapter seed. The deletion belongs to the continuation.
    const fresh = await adapter.open(givenOf());
    cleanups.push(() => adapter.close(fresh));
    expect(await textOf(fresh, 'notes/adapter-only.txt')).toBe('from the adapter');
  });
});

describe('recordsOfMessages', () => {
  it('keeps the text of user and assistant messages, in order, each parented on the one before', () => {
    const records = recordsOfMessages(
      [
        { role: 'system', content: 'ignored' },
        { role: 'user', content: 'one' },
        { role: 'tool', content: 'ignored' },
        { role: 'assistant', content: 'two' },
        { role: 'user', content: 'three' },
      ],
      '2026-10-21T00:00:00.000Z',
    );
    expect(records.map((record) => [record.type, record.parentUuid])).toEqual([
      ['user', null],
      ['assistant', 'seed-1'],
      ['user', 'seed-2'],
    ]);
    const assistant = records[1]?.message as { content: Array<{ text: string }> } | undefined;
    const last = records[2]?.message as { content: string } | undefined;
    expect(assistant?.content[0]?.text).toBe('two');
    expect(last?.content).toBe('three');
  });
});
