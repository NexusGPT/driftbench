import * as childProcess from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runItem, statsBank } from '../../src/ladders/stats/bank/index';
import { runIsolated } from '../../src/ladders/stats/bank/isolate';
import type { StatsImpl } from '../../src/ladders/stats/reference';
import { ROOT, real } from './support';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

// The item calls bootstrapCI on plain data and then on the same data shifted by 1e9, and compares the bounds.
// It reads the first result after the second call, so a product that reuses or overwrites the first result
// object fails it. The item runs in a child process of its own (validators/stats/GATE.md, "Node 24 and the
// shifted bootstrap item"); these tests keep its check as strict as it was.
const ID = 'stability.bootstrap-shift-1000000000';
const item = () => {
  const found = statsBank(ROOT).find((candidate) => candidate.id === ID);
  if (!found) throw new Error(`no bank item ${ID}`);
  return found;
};

type Interval = ReturnType<StatsImpl['bootstrapCI']>;
const withBootstrap = (bootstrapCI: StatsImpl['bootstrapCI']): StatsImpl => ({ ...real, bootstrapCI });

describe(`the item ${ID}`, () => {
  afterEach(() => vi.mocked(childProcess.spawn).mockClear());

  it('passes the package on several seeds', async () => {
    for (const seed of [1, 2, 3, 4])
      expect((await runItem(item(), seed, ROOT, real)).pass, `seed ${seed}`).toBe(true);
  });

  it('rejects a product that returns one shared object and fills it on every call', async () => {
    const shared = {} as Interval;
    const reuse = withBootstrap((values, options) =>
      Object.assign(shared, real.bootstrapCI(values, options)),
    );
    for (const seed of [1, 2, 3])
      expect((await runItem(item(), seed, ROOT, reuse)).pass, `seed ${seed}`).toBe(false);
  });

  it('rejects a product that overwrites the previous result when it is called again', async () => {
    let previous: Interval | undefined;
    const overwrite = withBootstrap((values, options) => {
      const result = real.bootstrapCI(values, options);
      if (previous) Object.assign(previous, result);
      previous = { ...result } as Interval;
      return previous;
    });
    for (const seed of [1, 2, 3])
      expect((await runItem(item(), seed, ROOT, overwrite)).pass, `seed ${seed}`).toBe(false);
  });

  it('is run by the isolation runner in a child process of its own', async () => {
    const { spawn } = await vi.importActual<typeof childProcess>('node:child_process');
    const sent: string[][] = [];
    vi.mocked(childProcess.spawn).mockImplementation((command, args, options) => {
      const child = spawn(command, args ?? [], options);
      const end = child.stdin?.end.bind(child.stdin);
      if (child.stdin && end)
        child.stdin.end = ((data?: unknown) => {
          sent.push(JSON.parse(String(data)) as string[]);
          return end(data as string);
        }) as typeof child.stdin.end;
      return child;
    });
    const bank = statsBank(ROOT);
    const others = bank.filter((candidate) => candidate.id.startsWith('reference.special.')).slice(0, 3);
    const run = await runIsolated([...others, item()], 1, ROOT, undefined, 2);
    expect([...run.keys()].sort()).toEqual([...others.map((o) => o.id), ID].sort());
    expect(sent.some((ids) => ids.length === 1 && ids[0] === ID)).toBe(true);
    expect(sent.filter((ids) => ids.includes(ID))).toEqual([[ID]]);
    expect(sent.flat().sort()).toEqual([...others.map((o) => o.id), ID].sort());
  }, 120_000);
});
