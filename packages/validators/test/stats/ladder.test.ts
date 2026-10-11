import * as stats from '@driftbench/stats';
import { describe, expect, it } from 'vitest';
import { runLadder } from '../../src/ladder';
import { registeredLadders } from '../../src/ladders/index';
import { BANK_LEVELS, statsBank } from '../../src/ladders/stats/bank/index';
import { runIsolated } from '../../src/ladders/stats/bank/isolate';
import { STATS_LADDER_VERSION, statsLadder } from '../../src/ladders/stats/index';
import { ROOT, SLOW } from './support';

describe('the stats ladder, version 2', { timeout: SLOW }, () => {
  const bank = statsBank(ROOT);

  it('is a bank of at least 300 items, unique ids, no family under 20, every tier present', () => {
    expect(STATS_LADDER_VERSION).toBe(2);
    expect(bank.length).toBeGreaterThanOrEqual(300);
    expect(new Set(bank.map((item) => item.id)).size).toBe(bank.length);
    const families = new Map<string, number>();
    for (const item of bank) families.set(item.family, (families.get(item.family) ?? 0) + 1);
    const small = [...families].filter(([, count]) => count < 20);
    expect(small).toEqual([]);
    expect(new Set(bank.map((item) => item.tier))).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(new Set(bank.map((item) => item.level))).toEqual(new Set(BANK_LEVELS));
    for (const item of bank) expect(item.component).toMatch(/^packages\/[a-z]+\/src/);
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
    expect(run.failing?.items[0]?.detail).toMatch(/^\[reference, tier 1\] 1 of \d+ cases differ/);
    expect(run.rows.slice(1).every((row) => row.pass === null)).toBe(true);
  });

  it('passes a level whose items all pass, in process', async () => {
    const ladder = statsLadder({ inProcess: true, filter: (item) => item.level === 'reference' });
    const run = await runLadder(ladder, { seed: 2, root: ROOT });
    expect(run.rows[0]?.observed).toBe(1);
    expect(run.level).toBe(BANK_LEVELS.length);
  });

  it('stops an item that does not finish and goes on with the next one', async () => {
    const items = bank.filter(
      (item) => item.id === 'degenerate.ksTest.nan-in-data' || item.id === 'degenerate.mean.empty',
    );
    const run = await runIsolated(items, 1, ROOT, () => 3_000, 1);
    expect(run.get('degenerate.ksTest.nan-in-data')).toMatchObject({ pass: false });
    expect(run.get('degenerate.ksTest.nan-in-data')?.detail).toMatch(
      /^did not finish within 3000 ms on seed 1/,
    );
    expect(run.get('degenerate.mean.empty')).toMatchObject({ pass: true });
  });

  it('runs the registered bank on seed 1 and stops at the degenerate level', async () => {
    const ladder = registeredLadders().stats as NonNullable<ReturnType<typeof registeredLadders>['stats']>;
    const run = await runLadder(ladder, { seed: 1, root: ROOT });
    expect(run.rows[0]?.pass).toBe(true);
    expect(run.failing?.id).toBe('degenerate');
    expect(run.level).toBe(1);
  });
});
