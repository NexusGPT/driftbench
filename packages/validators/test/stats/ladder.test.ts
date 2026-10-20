import * as childProcess from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as stats from '@agent-nexus/driftbench-stats';
import { describe, expect, it, vi } from 'vitest';
import { defineLadder, runLadder } from '../../src/ladder';
import { registeredLadders } from '../../src/ladders/index';
import { BANK_LEVELS, runInProcess, statsBank } from '../../src/ladders/stats/bank/index';
import { runIsolated } from '../../src/ladders/stats/bank/isolate';
import { STATS_LADDER_VERSION, statsLadder } from '../../src/ladders/stats/index';
import { isolatedFixtureItems } from './fixtures/isolated-items';
import { ROOT, SLOW } from './support';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

describe('the stats ladder, version 4', { timeout: SLOW }, () => {
  const bank = statsBank(ROOT);

  it('is a bank of at least 300 items, unique ids, no family under 20, every tier present', () => {
    expect(STATS_LADDER_VERSION).toBe(4);
    expect(bank.length).toBeGreaterThanOrEqual(300);
    expect(new Set(bank.map((item) => item.id)).size).toBe(bank.length);
    const families = new Map<string, number>();
    for (const item of bank) families.set(item.family, (families.get(item.family) ?? 0) + 1);
    const small = [...families].filter(([, count]) => count < 20);
    expect(small).toEqual([]);
    // Tier 5 holds the planned capabilities the docs name and the report's intervals at the campaign's cluster
    // count (validators/stats/NEEDS.md).
    expect(new Set(bank.map((item) => item.tier))).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(new Set(bank.map((item) => item.level))).toEqual(new Set(BANK_LEVELS));
    for (const item of bank) expect(item.component).toMatch(/^packages\/[a-z]+\/src/);
  });

  it('tags every item with a cause, one per roadmap method', () => {
    expect(bank.every((item) => typeof item.cause === 'string' && item.cause.length > 0)).toBe(true);
    const anova = new Set(
      bank.filter((item) => item.id.split('.')[1] === 'oneWayAnova').map((item) => item.cause),
    );
    expect([...anova]).toEqual(['oneWayAnova is missing from @agent-nexus/driftbench-stats']);
  });

  it('gives a stub method nothing: its generated items wait for one correct case', async () => {
    const items = bank.filter((item) => item.id.split('.')[1] === 'clusteredMeanInterval');
    const bad = (values: number[]) => {
      if (values.length === 0 || values.some((v) => !Number.isFinite(v))) throw new RangeError('bad input');
      return { estimate: 0.5, lower: 0, upper: 1 };
    };
    for (const stub of [() => Number.NaN, bad]) {
      const run = await runInProcess(items, 1, ROOT, {
        ...stats,
        clusteredMeanInterval: stub,
      } as unknown as typeof stats);
      expect(items.filter((item) => run.get(item.id)?.pass)).toEqual([]);
      const purity = run.get('roadmap-purity.clusteredMeanInterval');
      expect(purity?.detail).toMatch(/^the method is not correct yet: clusteredMeanInterval exists/);
    }
  });

  it('keeps version 1 as its first items: the reference groups and the simulated designs', () => {
    const ids = bank.map((item) => item.id);
    expect(ids).toContain('reference.special.logGamma');
    expect(ids).toContain('simulation.wilson-coverage.n20');
    expect(ids).toContain('simulation.clustered.c80x8-rho0.2');
    expect(ids).toContain('simulation.shares.pooled');
    expect(ids).toContain('simulation.unseen.warning.s60-spread5');
    expect(ids).toContain('simulation.power.n80-r3-p0.8');
  });

  it('is registered with seven levels of threshold 1', () => {
    const ladder = registeredLadders().stats;
    expect(ladder?.levels.map((level) => [level.id, level.threshold])).toEqual(
      BANK_LEVELS.map((level) => [level, 1]),
    );
  });

  it('stops at the first level with a failing item and names it, with its family and tier', async () => {
    const planted = statsLadder({
      impl: { logGamma: (x: number) => (x === 7 ? stats.logGamma(x) + 1e-4 : stats.logGamma(x)) },
      filter: (item) => item.level === 'reference' || item.id.startsWith('degenerate.mean.'),
    });
    const run = await runLadder(planted, { seed: 1, root: ROOT });
    expect(run.level).toBe(0);
    expect(run.failing?.id).toBe('reference');
    expect(run.failing?.items.map((item) => item.id)).toEqual(['reference.special.logGamma']);
    expect(run.failing?.items[0]?.detail).toMatch(
      /^\[reference, tier 1, cause: special\.logGamma differs from the scipy and numpy reference values\] 1 of \d+ cases differ/,
    );
    expect(run.rows.slice(1).every((row) => row.pass === null)).toBe(true);
  });

  it('passes a level whose items all pass, in process', async () => {
    const ladder = statsLadder({ inProcess: true, filter: (item) => item.level === 'reference' });
    const run = await runLadder(ladder, { seed: 2, root: ROOT });
    expect(run.rows[0]?.observed).toBe(1);
    expect(run.rows[0]?.bank?.every((entry) => entry.pass && entry.family === 'reference')).toBe(true);
    // The other levels hold no item under this filter, and an empty bank measures 0.
    expect(run.level).toBe(1);
  });

  it('stops an item that does not finish and goes on with the next one', async () => {
    const { spawn } = await vi.importActual<typeof childProcess>('node:child_process');
    const fixture = fileURLToPath(new URL('./fixtures/isolated-items.ts', import.meta.url));
    // Keep the real subprocess and timeout machinery; substitute only its controlled bank.
    const child = vi
      .mocked(childProcess.spawn)
      .mockClear()
      .mockImplementation((command, args, options) =>
        spawn(command, [...(args ?? []).slice(0, 2), fixture, ...(args ?? []).slice(3)], options),
      );
    try {
      const run = await runIsolated(isolatedFixtureItems, 1, ROOT, () => 3_000, 1);
      expect(run.get('fixture.never-finishes')).toMatchObject({ pass: false });
      expect(run.get('fixture.never-finishes')?.detail).toMatch(/^did not finish within 3000 ms on seed 1/);
      expect(run.get('fixture.finishes')).toMatchObject({ pass: true, detail: 'fixture completed' });
      // The timed-out process is replaced and resumes at the following item.
      expect(child).toHaveBeenCalledTimes(2);
      expect(child.mock.calls.map((call) => call[1]?.at(-1))).toEqual(['0', '1']);
    } finally {
      child.mockImplementation(spawn);
      child.mockClear();
    }
  });

  it('stops at the degenerate level when its fixture fails', async () => {
    const calls: string[] = [];
    const failingItem = { id: 'fixture.degenerate', component: 'fixture/stats', detail: 'planted failure' };
    const ladder = defineLadder({
      component: 'stats',
      version: STATS_LADDER_VERSION,
      levels: BANK_LEVELS.map((id) => ({
        id,
        name: id,
        metric: 'passed / planted',
        threshold: 1,
        compute: () => {
          calls.push(id);
          return id === 'degenerate' ? { value: 0, items: [failingItem] } : { value: 1, items: [] };
        },
      })),
    });
    const run = await runLadder(ladder, { seed: 1, root: ROOT });
    expect(run.rows[0]?.pass).toBe(true);
    expect(run.failing).toMatchObject({ id: 'degenerate', level: 2, items: [failingItem] });
    expect(run.level).toBe(1);
    expect(calls).toEqual(['reference', 'degenerate']);
    expect(run.rows.slice(2).every((row) => row.pass === null)).toBe(true);
  });
});
