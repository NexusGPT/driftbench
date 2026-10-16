import { describe, expect, it } from 'vitest';
import { type SweepReport, summariseSweep } from '../../src/ladders/generator/sweep-summary';

// A two-level bank: level one holds `a`, level two holds `b` and `c`.
const bank = {
  items: [
    { id: 'a', family: 'f', tier: 1 as const, level: 'one', component: 'x' },
    { id: 'b', family: 'f', tier: 2 as const, level: 'two', component: 'x' },
    { id: 'c', family: 'g', tier: 3 as const, level: 'two', component: 'x' },
  ],
  levels: [
    { id: 'one', name: 'level one' },
    { id: 'two', name: 'level two' },
  ],
};
const report = (
  seeds: SweepReport['seeds'],
  failingItems: NonNullable<SweepReport['failingItems']>,
  hidden?: number,
): SweepReport => ({
  component: 'generator',
  ladderVersion: 1,
  level: Math.min(...seeds.map((seed) => seed.level)),
  top: 2,
  seeds,
  failingItems,
  ...(hidden === undefined ? {} : { hiddenSeed: { seed: hidden, source: 'head', head: 'abc1234' } }),
});

// The hidden-seed job also runs seed 1 (`--hidden --seeds 1..1`): b fails on seed 1 only, c on both.
const seedOne = report(
  [{ seed: 1, hidden: false, level: 1 }],
  [
    { id: 'b', detail: 'b on 1', seeds: ['1'] },
    { id: 'c', detail: 'c on 1', seeds: ['1'] },
  ],
);
const seedTwo = report([{ seed: 2, hidden: false, level: 2 }], []);
const hiddenJob = report(
  [
    { seed: 1, hidden: false, level: 1 },
    { seed: 777, hidden: true, level: 1 },
  ],
  [
    { id: 'b', detail: 'b on 1', seeds: ['1'] },
    { id: 'c', detail: 'c on 1 and hidden', seeds: ['1', 'hidden'] },
  ],
  777,
);

describe('a sweep summary', () => {
  it('reads each failure from the seeds its entry names, not from the job that held it', () => {
    const summary = summariseSweep([hiddenJob, seedTwo, seedOne], bank);
    const item = (id: string) => summary.items.find((entry) => entry.id === id);
    // b failed on seed 1 in the hidden job's report: the hidden seed itself passes it.
    expect(item('b')?.failedOn).toEqual(['1']);
    expect(item('c')?.failedOn).toEqual(['1', 'hidden']);
    expect(item('a')?.pass).toBe(true);
    expect(summary.passing).toBe(1);
  });

  it('keeps a seed two jobs measured once, and keeps the hidden seed from the report', () => {
    const summary = summariseSweep([hiddenJob, seedTwo, seedOne], bank);
    expect(summary.seeds).toEqual(['1', '2', 'hidden']);
    expect(summary.perSeedLevels).toEqual([
      { seed: '1', level: 1 },
      { seed: '2', level: 2 },
      { seed: 'hidden', level: 1 },
    ]);
    expect(summary.levels.map((level) => level.perSeed)).toEqual([
      [true, true, true],
      [false, true, false],
    ]);
    expect(summary.hiddenSeed).toEqual({ seed: 777, source: 'head', head: 'abc1234' });
  });

  it('refuses two measurements of one seed at different levels', () => {
    const other = report([{ seed: 1, hidden: false, level: 2 }], []);
    expect(() => summariseSweep([hiddenJob, other], bank)).toThrow(/seed 1 is at level/);
  });

  it('refuses a report whose level disagrees with its own failing items', () => {
    const wrong = report(
      [{ seed: 3, hidden: false, level: 2 }],
      [{ id: 'a', detail: 'a on 3', seeds: ['3'] }],
    );
    expect(() => summariseSweep([wrong], bank)).toThrow(/the report says level 2, its items 0/);
  });
});
