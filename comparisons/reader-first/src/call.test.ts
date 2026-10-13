import { EventEmitter } from 'node:events';
import { appendFile, mkdtemp } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallDeadlineReached, CallFailed, createCaller, Recordings } from './call';

const state = vi.hoisted(() => ({
  stdout: '',
  starts: 0,
  afterFolder: () => {},
}));

vi.mock('node:fs/promises', () => ({
  appendFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  mkdtemp: vi.fn(async () => {
    state.afterFolder();
    return '/fake-process-cwd';
  }),
  readFile: vi.fn(async () => ''),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    state.starts++;
    const child = new EventEmitter();
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const stdin = Object.assign(new EventEmitter(), {
      end: () => {
        queueMicrotask(() => {
          stdout.emit('data', Buffer.from(state.stdout));
          child.emit('close', 0);
        });
      },
    });
    return Object.assign(child, { stdout, stderr, stdin, kill: vi.fn() });
  }),
}));

const prompt = { system: 'Synthetic system', user: 'Synthetic request' };
const labels = { item: 'fixture', order: 'AB', contestant: 'reader-first' };
const defaultDeadline = Date.parse('2026-10-13T04:39:00Z');

function caller(lastNewCallAt?: number) {
  return createCaller(
    new Recordings('/fixture/haiku.jsonl'),
    { model: 'fake', command: 'never-started', maxCallUsd: 0.1, lastNewCallAt },
    { capUsd: 19.2 },
  );
}

function recorded() {
  const invocation = vi.mocked(appendFile).mock.calls[0];
  if (!invocation) throw new Error('Expected an appended recording');
  return { path: invocation[0], entry: JSON.parse(String(invocation[1])) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(defaultDeadline - 60_000);
  state.starts = 0;
  state.afterFolder = () => {};
  state.stdout = JSON.stringify({ result: 'Synthetic answer', total_cost_usd: 0.03, is_error: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('recorded caller budget and deadline guards', () => {
  it('rejects at the default deadline before allocating a process folder', async () => {
    vi.setSystemTime(defaultDeadline);
    const run = caller();
    await expect(run.call(prompt, labels)).rejects.toBeInstanceOf(CallDeadlineReached);
    expect(mkdtemp).not.toHaveBeenCalled();
    expect(state.starts).toBe(0);
    expect(appendFile).not.toHaveBeenCalled();
    expect(run.calls()).toBe(0);
  });

  it('rechecks the cutoff after asynchronous folder setup and before spawn', async () => {
    state.afterFolder = () => vi.setSystemTime(defaultDeadline + 1);
    const run = caller();
    await expect(run.call(prompt, labels)).rejects.toBeInstanceOf(CallDeadlineReached);
    expect(mkdtemp).toHaveBeenCalledOnce();
    expect(state.starts).toBe(0);
    expect(appendFile).not.toHaveBeenCalled();
    expect(run.spent()).toBe(0);
    expect(run.calls()).toBe(0);
  });

  it('uses an explicitly supplied deadline at both guards', async () => {
    const extended = defaultDeadline + 60_000;
    vi.setSystemTime(defaultDeadline + 1);
    await expect(caller(extended).call(prompt, labels)).resolves.toMatchObject({ text: 'Synthetic answer' });
    expect(state.starts).toBe(1);
    state.afterFolder = () => vi.setSystemTime(extended);
    await expect(caller(extended).call({ ...prompt, user: 'Second request' }, labels)).rejects.toBeInstanceOf(
      CallDeadlineReached,
    );
    expect(state.starts).toBe(1);
  });

  it('rejects a non-finite deadline without spawning or recording a charge', async () => {
    await expect(caller(Number.NaN).call(prompt, labels)).rejects.toThrow('Invalid call deadline');
    expect(state.starts).toBe(0);
    expect(appendFile).not.toHaveBeenCalled();
  });

  it('persists a known failure cost and includes it in spent and attempted calls', async () => {
    state.stdout = JSON.stringify({ result: 'Synthetic failure', is_error: true, total_cost_usd: 0.04 });
    const run = caller();
    await expect(run.call(prompt, labels)).rejects.toMatchObject({ name: 'CallFailed', costUsd: 0.04 });
    expect(run.spent()).toBe(0.04);
    expect(run.calls()).toBe(1);
    expect(state.starts).toBe(1);
    const { path, entry } = recorded();
    expect(path).toBe('/fixture/haiku.failures.jsonl');
    expect(entry).toMatchObject({ ...labels, model: 'fake', costUsd: 0.04, reservedUsd: 0 });
    expect(entry.reason).toContain('Synthetic failure');
    expect(entry.key).toHaveLength(20);
    expect(entry.startedAt).toBeDefined();
    expect(entry.finishedAt).toBeDefined();
    expect(entry).not.toHaveProperty('text');
  });

  it('retains known costs for a session-limit error without retrying', async () => {
    state.stdout = JSON.stringify({
      result: 'Synthetic session limit',
      is_error: true,
      total_cost_usd: 0.02,
    });
    const run = caller();
    await expect(run.call(prompt, labels)).rejects.toMatchObject({ costUsd: 0.02 });
    expect(state.starts).toBe(1);
    expect(recorded().entry).toMatchObject({ costUsd: 0.02, reservedUsd: 0 });
    expect(run.spent()).toBe(0.02);
  });

  it('reserves the configured maximum when the failed process returns no cost', async () => {
    state.stdout = 'malformed synthetic output';
    const run = caller();
    await expect(run.call(prompt, labels)).rejects.toBeInstanceOf(CallFailed);
    expect(run.spent()).toBe(0);
    expect(run.calls()).toBe(1);
    expect(recorded()).toMatchObject({
      path: '/fixture/haiku.failures.jsonl',
      entry: { costUsd: null, reservedUsd: 0.1 },
    });
  });

  it('does not turn an invalid negative returned cost into a negative charge', async () => {
    state.stdout = JSON.stringify({ result: 'Synthetic failure', is_error: true, total_cost_usd: -1 });
    const run = caller();
    await expect(run.call(prompt, labels)).rejects.toBeInstanceOf(CallFailed);
    expect(run.spent()).toBe(0);
    expect(recorded().entry).toMatchObject({ costUsd: null, reservedUsd: 0.1 });
  });

  it('preserves the successful recording shape and replays without a second process', async () => {
    const run = caller();
    const result = await run.call(prompt, labels);
    expect(result).toMatchObject({ ...labels, model: 'fake', text: 'Synthetic answer', costUsd: 0.03 });
    const { path, entry } = recorded();
    expect(path).toBe('/fixture/haiku.jsonl');
    expect(entry).toEqual(result);
    expect(entry).not.toHaveProperty('reservedUsd');
    expect(entry).not.toHaveProperty('reason');
    vi.setSystemTime(defaultDeadline + 1);
    expect(await run.call(prompt, labels)).toEqual(result);
    expect(run.calls()).toBe(1);
    expect(run.replayed()).toBe(1);
    expect(run.spent()).toBe(0.03);
    expect(state.starts).toBe(1);
    expect(appendFile).toHaveBeenCalledOnce();
  });
});
