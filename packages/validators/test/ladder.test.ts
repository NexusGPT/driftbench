import { describe, expect, it } from 'vitest';
import { defineLadder, formatLadder, passes, runLadder, runSeeds } from '../src/index';
import { plantedLadder } from './support';

describe('runLadder', () => {
  for (const full of [false, true]) {
    it(`caps computation at level 4 even when all seven levels pass (full=${full})`, async () => {
      const calls: number[] = [];
      const ladder = defineLadder({
        component: 'capped',
        levels: Array.from({ length: 7 }, (_, index) => ({
          id: `level-${index + 1}`,
          name: `level ${index + 1}`,
          metric: 'found / planted',
          threshold: 1,
          compute: () => {
            calls.push(index + 1);
            return { value: 1, items: [] };
          },
        })),
      });
      const run = await runLadder(ladder, { seed: 1, maxLevel: 4, full });
      expect(calls).toEqual([1, 2, 3, 4]);
      expect(run.level).toBe(4);
      expect(run.top).toBe(7);
      expect(run.failing).toBeNull();
      expect(run.rows.map((row) => row.pass)).toEqual([true, true, true, true, null, null, null]);
      expect(run.rows.slice(4).map((row) => [row.observed, row.itemCount])).toEqual([
        [null, null],
        [null, null],
        [null, null],
      ]);
    });
  }

  it('still stops at a failure below the cap and preserves its diagnostics', async () => {
    const { ladder, calls } = plantedLadder([4]);
    const run = await runLadder(ladder, { seed: 4, maxLevel: 3 });
    expect(run.level).toBe(1);
    expect(run.failing?.items.map((item) => item.id)).toEqual(['plant-4-a', 'plant-4-b']);
    expect(calls).toEqual({ first: 1, second: 1, third: 0 });
  });

  it('rejects invalid caps before computing any level', async () => {
    const { ladder, calls } = plantedLadder([]);
    for (const maxLevel of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 4]) {
      await expect(runLadder(ladder, { seed: 1, maxLevel })).rejects.toThrow(/maxLevel/);
    }
    expect(calls).toEqual({ first: 0, second: 0, third: 0 });
  });

  it('stops at the first failing level and returns its items, without computing the levels above', async () => {
    const { ladder, calls } = plantedLadder([4]);
    const run = await runLadder(ladder, { seed: 4 });
    expect(run.level).toBe(1);
    expect(run.top).toBe(3);
    expect(run.failing?.id).toBe('second');
    expect(run.failing?.items.map((item) => item.id)).toEqual(['plant-4-a', 'plant-4-b']);
    expect(calls).toEqual({ first: 1, second: 1, third: 0 });
    expect(run.rows.map((row) => [row.level, row.pass, row.observed, row.itemCount])).toEqual([
      [1, true, 1, 0],
      [2, false, 0.5, 2],
      [3, null, null, null],
    ]);
  });

  it('reaches the top level when nothing fails, an atMost level passing at or below its threshold', async () => {
    const { ladder, calls } = plantedLadder([]);
    const run = await runLadder(ladder, { seed: 1 });
    expect(run.level).toBe(3);
    expect(run.failing).toBeNull();
    expect(calls.third).toBe(1);
  });

  it('fails a level that throws, with one item naming the error', async () => {
    const ladder = defineLadder({
      component: 'thrower',
      levels: [
        {
          id: 'boom',
          name: 'throws',
          metric: 'a / b',
          threshold: 1,
          compute: () => {
            throw new Error('fixture missing');
          },
        },
      ],
    });
    const run = await runLadder(ladder, { seed: 1 });
    expect(run.level).toBe(0);
    expect(run.failing?.items).toEqual([
      { id: 'boom:error', component: 'thrower', detail: 'the level threw: fixture missing' },
    ]);
    expect(formatLadder(await runSeeds(ladder, [{ seed: 1, hidden: false }]))).toContain('error FAIL (1)');
  });

  it('never passes NaN, and compares in the declared direction', () => {
    expect(passes(Number.NaN, 0)).toBe(false);
    expect(passes(Number.NaN, 0, 'atMost')).toBe(false);
    expect(passes(0.93, 0.93)).toBe(true);
    expect(passes(0.929, 0.93)).toBe(false);
    expect(passes(0.05, 0.05, 'atMost')).toBe(true);
    expect(passes(0.051, 0.05, 'atMost')).toBe(false);
  });
});

describe('defineLadder', () => {
  const level = {
    id: 'one',
    name: 'one',
    metric: 'a / b',
    threshold: 1,
    compute: () => ({ value: 1, items: [] }),
  };
  it('refuses an empty ladder, a repeated level id, a reserved component and a bad threshold', () => {
    expect(() => defineLadder({ component: 'x', levels: [] })).toThrow(/no level/);
    expect(() => defineLadder({ component: 'x', levels: [level, level] })).toThrow(/repeats/);
    expect(() => defineLadder({ component: 'all', levels: [level] })).toThrow(/reserved/);
    expect(() => defineLadder({ component: 'Bad Name', levels: [level] })).toThrow(/lower case/);
    expect(() => defineLadder({ component: 'x', levels: [{ ...level, threshold: Number.NaN }] })).toThrow(
      /finite/,
    );
  });
});

describe('formatLadder', () => {
  it('prints one row per level, one column per seed, the level of the run and the failing items', async () => {
    const { ladder } = plantedLadder([2]);
    const report = await runSeeds(ladder, [
      { seed: 1, hidden: false },
      { seed: 2, hidden: false },
    ]);
    const text = formatLadder(report, { floor: 2 });
    expect(text).toContain('Validator planted');
    expect(text).toMatch(/2\s+second rung\s+found \/ planted\s+>= 0\.9\s+1 pass\s+0\.5 FAIL \(2\)/);
    expect(text).toMatch(/3\s+third rung\s+false alarms \/ runs\s+<= 0\.05\s+0 pass\s+not run/);
    expect(text).toContain('Level per seed: 1 = 3, 2 = 1');
    expect(text).toContain('Level of the run: 1 of 3, the minimum over 2 seeds.');
    expect(text).toContain('Floor: 2. BELOW THE FLOOR.');
    expect(text).toContain('Seed 2, level 2 second (second rung), 2 items:');
    expect(text).toContain('plant-2-a  [fixture/finder]  the planted item a was missed');
  });
});
