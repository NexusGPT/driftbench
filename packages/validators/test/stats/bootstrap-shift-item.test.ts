import * as childProcess from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInProcess, runItem, statsBank } from '../../src/ladders/stats/bank/index';
import { runIsolated } from '../../src/ladders/stats/bank/isolate';
import type { StatsImpl } from '../../src/ladders/stats/reference';
import { ROOT, real } from './support';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

// The item calls bootstrapCI on plain data and then on the same data shifted by 1e9, and compares the bounds. It
// reads the first result after the second call. On Node 24 the check fails on a few seeds of a full run with a
// correct package (validators/stats/GATE.md, "Node 24 and the shifted bootstrap item"); when it fails the item
// runs the same two calls once more in the same child, and passes only if the retry passes. A retry that passes
// is reported as "flaky: <item>". These tests keep every real fault failing on the retry too.
const ID = 'stability.bootstrap-shift-1000000000';
const MEAN_ID = 'stability.mean-shift-1000000';
const find = (id: string) => {
  const found = statsBank(ROOT).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no bank item ${id}`);
  return found;
};
const item = () => find(ID);

type Interval = ReturnType<StatsImpl['bootstrapCI']>;
const withBootstrap = (bootstrapCI: StatsImpl['bootstrapCI']): StatsImpl => ({ ...real, bootstrapCI });

describe(`the item ${ID}`, () => {
  afterEach(() => vi.mocked(childProcess.spawn).mockClear());

  it('passes the package on several seeds, and none of them is flaky', async () => {
    for (const seed of [1, 2, 3, 4]) {
      const outcome = await runItem(item(), seed, ROOT, real);
      expect(outcome.pass, `seed ${seed}`).toBe(true);
      expect(outcome.flaky, `seed ${seed}`).toBeUndefined();
    }
  });

  it('passes a first attempt that fails and a retry that passes, and reports it as flaky', async () => {
    // The Node 24 fault: a result read after the next call shows the next call's numbers. Only the first
    // attempt suffers it.
    let calls = 0;
    const once = withBootstrap((values, options) => {
      calls += 1;
      const result = real.bootstrapCI(values, options);
      return calls === 1 ? Object.assign(result, { lower: result.lower + 1e9 }) : result;
    });
    const outcome = await runItem(item(), 1, ROOT, once);
    expect(calls).toBe(4);
    expect(outcome.pass).toBe(true);
    expect(outcome.flaky).toBe(true);
    expect(outcome.detail).toBe(`flaky: ${ID}`);
  });

  it('rejects a product that returns one shared object and fills it on every call', async () => {
    const shared = {} as Interval;
    const reuse = withBootstrap((values, options) =>
      Object.assign(shared, real.bootstrapCI(values, options)),
    );
    for (const seed of [1, 2, 3]) {
      const outcome = await runItem(item(), seed, ROOT, reuse);
      expect(outcome.pass, `seed ${seed}`).toBe(false);
      expect(outcome.flaky, `seed ${seed}`).toBeUndefined();
    }
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

  it('rejects a product that keeps the origin of its first call in a cache', async () => {
    let origin: number | undefined;
    const stale = withBootstrap((values, options) => {
      origin ??= values[0] as number;
      const centred = real.bootstrapCI(
        values.map((x) => x - (values[0] as number)),
        options,
      );
      return { ...centred, lower: centred.lower + origin, upper: centred.upper + origin };
    });
    for (const seed of [1, 2, 3]) {
      origin = undefined;
      const outcome = await runItem(item(), seed, ROOT, stale);
      expect(outcome.pass, `seed ${seed}`).toBe(false);
    }
  });

  it('keeps the position and the child of every item as they are', async () => {
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
    const chosen = bank.filter(
      (candidate) =>
        candidate.id.startsWith('reference.special.') || candidate.id === ID || candidate.id === MEAN_ID,
    );
    const shards = 2;
    const run = await runIsolated(chosen, 1, ROOT, undefined, shards);
    expect([...run.keys()].sort()).toEqual(chosen.map((c) => c.id).sort());
    // Round robin over the items in bank order, nothing set apart.
    const expected = Array.from({ length: shards }, (_, k) =>
      chosen.filter((_, i) => i % shards === k).map((c) => c.id),
    );
    expect(sent.map((ids) => ids.join()).sort()).toEqual(expected.map((ids) => ids.join()).sort());
    expect(bank.every((candidate) => !('freshChild' in candidate))).toBe(true);
    const index = (id: string) => bank.findIndex((candidate) => candidate.id === id);
    expect(index('scale.mean')).toBeGreaterThan(-1);
    expect(index('scale.mean')).toBeLessThan(index(MEAN_ID));
    expect(index(MEAN_ID)).toBeLessThan(index(ID));
  }, 120_000);
});

describe(`the item ${MEAN_ID}`, () => {
  // A product that sizes a work buffer on the first large call and keeps that size: after scale.mean (1e6
  // values) it divides the next sums by the old size. The item catches it only because it runs in the same
  // child, after scale.mean, in the bank order; it is not retried, and a retry would fail the same way.
  const cached = (): StatsImpl => {
    let size: number | undefined;
    return {
      ...real,
      mean: (values) => {
        size ??= values.length;
        return values.reduce((a, b) => a + b, 0) / size;
      },
    };
  };

  it('fails a stale workspace-size cache kept from scale.mean, in the bank order', async () => {
    const items = ['scale.mean', MEAN_ID].map(find);
    const run = await runInProcess(items, 1, ROOT, cached());
    expect(run.get('scale.mean')?.pass).toBe(true);
    expect(run.get(MEAN_ID)?.pass).toBe(false);
    expect(run.get(MEAN_ID)?.flaky).toBeUndefined();
  }, 120_000);

  it('passes the same product when the item runs alone, so the order is what catches it', async () => {
    const run = await runInProcess([find(MEAN_ID)], 1, ROOT, cached());
    expect(run.get(MEAN_ID)?.pass).toBe(true);
  });

  it('passes the package after scale.mean', async () => {
    const items = ['scale.mean', MEAN_ID].map(find);
    const run = await runInProcess(items, 1, ROOT, real);
    expect([...run.values()].map((r) => r.pass)).toEqual([true, true]);
  }, 120_000);
});
