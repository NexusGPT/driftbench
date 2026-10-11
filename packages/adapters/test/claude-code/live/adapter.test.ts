import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AdapterTransportError,
  type AgentAdapter,
  AgentFailure,
  Observed,
  type Session,
} from '@driftbench/core';
import { localProvider } from '@driftbench/sandbox';
import { afterEach, describe, expect, it } from 'vitest';
import { type ClaudeCodeLiveOptions, claudeCodeLiveAdapter } from '../../../src/claude-code/live';
import {
  ASK_INVOICE,
  ASK_WEEKLY,
  callsOf,
  ESTATE,
  FAKE,
  givenOf,
  MAP_HASH,
  scratch,
  turnOf,
} from './support';

/**
 * The live runner against the FAKE headless command of the Northwind fixture: no model call, no cost. The
 * fake plays a recorded stream chosen by the ask, writes the guard rows and step rows the estate's hooks
 * would write, and changes the workspace as the stream says.
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
    env: { FAKE_CALLS: work.calls },
    retries: { max: 3, backoffMs: 0 },
    pins: [MAP_HASH],
    ...extra,
  });
  return { adapter, work };
}

async function openRun(adapter: AgentAdapter, vars: Record<string, unknown> = {}) {
  const given = givenOf(vars);
  const session = await adapter.open(given);
  cleanups.push(() => adapter.close(session));
  return { session, given };
}

describe('claudeCodeLiveAdapter', () => {
  it('maps one turn of the stream into one Observed: calls, skills, guards, stages, diff, cost', async () => {
    const { adapter } = await setup();
    const { session, given } = await openRun(adapter);
    const observed = await adapter.send(session, turnOf(0, ASK_WEEKLY, given));
    expect(() => Observed.parse(observed)).not.toThrow();
    expect(observed.toolCalls.map((call) => call.label)).toEqual(['Skill', 'Read', 'Read', 'Edit', 'Bash']);
    expect(observed.runtime?.skills?.map((skill) => skill.name)).toEqual(['weekly-report']);
    expect(observed.runtime?.guards?.map((guard) => `${guard.name}:${guard.verdict}`)).toEqual([
      'read-before-edit.py:allow',
      'block-force-push.sh:allow',
      'reply-length.py:allow',
    ]);
    expect(observed.runtime?.stages?.map((stage) => stage.name)).toEqual(['plan', 'do', 'verify', 'report']);
    expect(observed.workspaceDiff).toEqual({ created: [], changed: ['reports/2026-W41.md'], deleted: [] });
    expect(observed.artifacts?.map((artifact) => artifact.path)).toEqual(['reports/2026-W41.md']);
    expect(observed.text).toContain('2 shipments are late this week');
    expect(observed.cost).toEqual({ usd: 0, inputTokens: 1140, outputTokens: 150 });
    const executions = observed.executions ?? [];
    expect(executions.map((record) => record.role)).toEqual(['command', 'agent']);
    expect(executions[0]?.exitCode).toBe(0);
    expect(executions.at(-1)?.exitCode).toBe(0);
    const raw = observed.raw as { live: { sessionId: string; attempts: unknown[]; pin: string } };
    expect(raw.live.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(raw.live.attempts).toEqual([{ exitCode: 0, overloaded: false }]);
    expect(raw.live.pin).toBe(MAP_HASH);
    const file = await adapter.readArtifact?.(session, 'reports/2026-W41.md');
    expect(Buffer.from(file ?? new Uint8Array()).toString('utf8')).toContain('2 (NW-55012, NW-55031)');
  });

  it('sends the ask alone, in the public headless shape, into a folder holding only the estate and the seed', async () => {
    const { adapter, work } = await setup();
    const { session, given } = await openRun(adapter);
    await adapter.send(session, turnOf(0, ASK_INVOICE, given));
    const [call] = await callsOf(work.calls);
    expect(call?.argv).toEqual(['-p', ASK_INVOICE, '--output-format', 'stream-json', '--verbose']);
    expect(call?.ask).toBe(ASK_INVOICE);
    expect(call?.estate).toBe(true);
    const sandboxes = join(work.dir, 'sandboxes');
    const [folder] = await readdir(sandboxes);
    const top = (await readdir(join(sandboxes, folder ?? ''))).sort();
    expect(top).toEqual(['.claude', 'CLAUDE.md', 'invoices', 'ledger', 'orders', 'reports', 'shipments']);
    // Nothing the generator wrote, and none of the fixture's own test files, is in the agent's folder.
    const claude = await readdir(join(sandboxes, folder ?? '', '.claude'));
    expect(claude.sort()).toEqual(['agents', 'guards', 'memory', 'settings.json', 'skills', 'steps.json']);
  });

  it('leaves the guards out when the estate wrote no decision row, and keeps the stages it did not write out too', async () => {
    const { adapter } = await setup();
    const { session, given } = await openRun(adapter);
    const observed = await adapter.send(session, turnOf(0, ASK_INVOICE, given));
    expect(observed.runtime?.guards).toBeUndefined();
    expect(observed.runtime?.stages).toBeUndefined();
    expect(observed.runtime?.skills?.map((skill) => skill.name)).toEqual(['invoice-reconcile']);
    expect(observed.workspaceDiff).toEqual({ created: [], changed: [], deleted: [] });
  });

  it('resumes the session the runtime named on the next turn, and gives each turn its own rows', async () => {
    const { adapter, work } = await setup();
    const { session, given } = await openRun(adapter);
    const first = await adapter.send(session, turnOf(0, ASK_WEEKLY, given));
    const second = await adapter.send(session, turnOf(1, ASK_INVOICE, given));
    const calls = await callsOf(work.calls);
    const id = (first.raw as { live: { sessionId: string } }).live.sessionId;
    expect(calls[1]?.argv).toEqual([
      '-p',
      ASK_INVOICE,
      '--output-format',
      'stream-json',
      '--verbose',
      '--resume',
      id,
    ]);
    expect(calls[1]?.records).toBeGreaterThan(0);
    expect((second.raw as { live: { sessionId: string } }).live.sessionId).toBe(id);
    // The second turn's rows are its own: the estate wrote no guard row in it.
    expect(second.runtime?.guards).toEqual([]);
    expect(second.runtime?.stages).toEqual([]);
    expect(second.workspaceDiff?.changed).toEqual([]);
  });

  it('fails a spec generated from another estate map, and runs an unpinned copy with a note', async () => {
    const { adapter } = await setup({ pins: ['0000000000000000'] });
    await expect(adapter.open(givenOf())).rejects.toBeInstanceOf(AgentFailure);
    const { adapter: open } = await setup({ pins: [] });
    const { session, given } = await openRun(open);
    const observed = await open.send(session, turnOf(0, ASK_INVOICE, given));
    expect((observed.raw as { live: { pin: string } }).live.pin).toBe(`unchecked ${MAP_HASH}`);
  });

  it('refuses a command that is not there, as a transport error', async () => {
    const { adapter } = await setup({ command: '/nowhere/claude' });
    await expect(adapter.open(givenOf())).rejects.toBeInstanceOf(AdapterTransportError);
  });

  it('removes the sandbox and the state folder at close', async () => {
    const { adapter, work } = await setup();
    const given = givenOf();
    const session: Session = await adapter.open(given);
    await adapter.send(session, turnOf(0, ASK_INVOICE, given));
    await adapter.close(session);
    expect(await readdir(join(work.dir, 'sandboxes'))).toEqual([]);
    expect(await readdir(join(work.dir, 'state'))).toEqual([]);
  });
});
