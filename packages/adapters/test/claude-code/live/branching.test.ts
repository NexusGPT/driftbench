import { join } from 'node:path';
import type { Message, ResolvedGiven, Sandbox, Session } from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ClaudeCodeLiveOptions, claudeCodeLiveAdapter } from '../../../src/claude-code/live';
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
    expect(Object.keys(files).filter((path) => path === 'CLAUDE.md' || path.startsWith('.claude/'))).toEqual([]);

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
    cleanups.push(() => adapter.close(a), () => adapter.close(b));
    await sandboxOf(a).seed({ files: { 'notes/only-a.txt': 'a' } });
    expect(await sandboxOf(b).listFiles()).not.toContain('notes/only-a.txt');
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
    expect((records[1]?.message as { content: Array<{ text: string }> }).content[0]?.text).toBe('two');
    expect((records[2]?.message as { content: string }).content).toBe('three');
  });
});
