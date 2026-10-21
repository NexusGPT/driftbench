import { describe, expect, it } from 'vitest';
import { defineLadder, formatLadder, mergeSeedRuns, passes, runLadder, runSeeds } from '../src/index';
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

/** Seven levels; the levels listed in `failing` fail with one named item, and every level returns a one-entry bank. */
function sevenLevels(failing: readonly number[]) {
  const calls: number[] = [];
  const ladder = defineLadder({
    component: 'sliced',
    levels: Array.from({ length: 7 }, (_, index) => ({
      id: `level-${index + 1}`,
      name: `level ${index + 1}`,
      metric: 'found / planted',
      threshold: 1,
      compute: () => {
        calls.push(index + 1);
        const bad = failing.includes(index + 1);
        return {
          value: bad ? 0.5 : 1,
          items: bad ? [{ id: `item-${index + 1}`, component: 'fixture', detail: 'missed' }] : [],
          bank: [{ id: `bank-${index + 1}`, component: 'fixture', pass: !bad }],
        };
      },
    })),
  });
  return { ladder, calls };
}

const SLICES: [number, number][][] = [
  [[1, 7]],
  [
    [1, 3],
    [4, 5],
    [6, 7],
  ],
  [
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
    [6, 6],
    [7, 7],
  ],
];

describe('fromLevel and mergeSeedRuns', () => {
  it('computes only the levels from fromLevel through maxLevel, listing the others as not run, and runs on above a failure', async () => {
    const { ladder, calls } = sevenLevels([3]);
    const run = await runLadder(ladder, { seed: 1, fromLevel: 2, maxLevel: 5, full: true });
    expect(calls).toEqual([2, 3, 4, 5]);
    expect(run.rows.map((row) => row.pass)).toEqual([null, true, false, true, true, null, null]);
    await expect(runLadder(ladder, { seed: 1, fromLevel: 0 })).rejects.toThrow(RangeError);
    await expect(runLadder(ladder, { seed: 1, fromLevel: 8 })).rejects.toThrow(RangeError);
    const above = await runLadder(ladder, { seed: 1, fromLevel: 6, maxLevel: 4, full: true });
    expect(above.rows.every((row) => row.pass === null)).toBe(true);
  });

  it('joins slices into exactly the run one pass gives, stopping or full, wherever the first failure falls', async () => {
    for (const failing of [[], [1], [4], [7], [3, 6], [2, 3, 4, 5, 6, 7]]) {
      for (const through of [7, 5]) {
        for (const full of [false, true]) {
          const { ladder } = sevenLevels(failing);
          const whole = await runLadder(ladder, { seed: 3, hiddenSeed: true, maxLevel: through, full });
          for (const plan of SLICES) {
            const slices = [];
            for (const [from, to] of plan)
              slices.push(
                await runLadder(ladder, {
                  seed: 3,
                  hiddenSeed: true,
                  fromLevel: from,
                  maxLevel: Math.min(to, through),
                  full: true,
                }),
              );
            expect(
              mergeSeedRuns(slices, through, full),
              JSON.stringify({ failing, through, full, plan }),
            ).toEqual(whole);
          }
        }
      }
    }
  });

  it('names a level no slice computed, a level two slices computed, and slices that do not belong together', async () => {
    const { ladder } = sevenLevels([]);
    const slice = (seed: number, from: number, to: number) =>
      runLadder(ladder, { seed, fromLevel: from, maxLevel: to, full: true });
    expect(mergeSeedRuns([await slice(1, 1, 3), await slice(1, 5, 7)], 7)).toBe(
      'level 4 of seed 1 was computed in no slice',
    );
    expect(mergeSeedRuns([await slice(1, 1, 4), await slice(1, 4, 7)], 7)).toBe(
      'level 4 of seed 1 was computed in 2 slices',
    );
    expect(mergeSeedRuns([await slice(1, 1, 4)], 4)).not.toBeTypeOf('string');
    expect(mergeSeedRuns([await slice(1, 1, 4)], 5)).toBe('level 5 of seed 1 was computed in no slice');
    expect(mergeSeedRuns([await slice(1, 1, 7), await slice(2, 1, 7)], 7)).toBe(
      'the slices hold the seeds 1 and 2',
    );
    expect(mergeSeedRuns([], 7)).toBe('there is no slice to join');
    expect(mergeSeedRuns([await slice(1, 1, 7)], 8)).toContain('outside 1 to 7');
  });

  it('does not read a hole above the first failing level as a lost slice, except in a full join', async () => {
    const { ladder } = sevenLevels([2]);
    const stopped = await runLadder(ladder, { seed: 1 });
    expect(mergeSeedRuns([stopped], 7)).toEqual(stopped);
    expect(mergeSeedRuns([stopped], 7, true)).toBe('level 3 of seed 1 was computed in no slice');
  });
});
