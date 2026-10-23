import { describe, expect, it } from 'vitest';
import { runLadder } from '../../src/ladder';
import { BANK_LEVELS, type BankItem } from '../../src/ladders/stats/bank/index';
import { statsLadder } from '../../src/ladders/stats/index';
import { ROOT } from './support';

/**
 * A run of some levels of the statistics ladder runs the items of those levels only (a slice of levels 1 to 2 ran the
 * whole bank of 1167 items, about 500 s on a CI runner), and a run never answers a run of other levels. The filter
 * of the ladder options sees the items a run is about to run and keeps none, so these tests run no item.
 */

function recorded() {
  const runs: BankItem['level'][][] = [];
  let current: BankItem['level'][] | undefined;
  const ladder = statsLadder({
    inProcess: true,
    filter: (item) => {
      // The filter of one run is called in one synchronous pass; the next microtask ends the pass.
      if (!current) {
        current = [];
        runs.push(current);
        queueMicrotask(() => {
          current = undefined;
        });
      }
      current.push(item.level);
      return false;
    },
  });
  return { ladder, runs };
}

const levelsOf = (run: BankItem['level'][]) => [...new Set(run)];

describe('a run of some levels of the statistics ladder', () => {
  it('runs the items of its levels only', async () => {
    const { ladder, runs } = recorded();
    await runLadder(ladder, { seed: 1, root: ROOT, maxLevel: 2 });
    expect(runs).toHaveLength(1);
    expect(levelsOf(runs[0] as BankItem['level'][])).toEqual([BANK_LEVELS[0], BANK_LEVELS[1]]);
  });

  it('runs the items of a middle slice and of the whole ladder, each by itself, on one ladder object', async () => {
    const { ladder, runs } = recorded();
    await runLadder(ladder, { seed: 1, root: ROOT, maxLevel: 2 });
    await runLadder(ladder, { seed: 1, root: ROOT, fromLevel: 3, maxLevel: 4 });
    await runLadder(ladder, { seed: 1, root: ROOT });
    // The whole ladder is not answered by the slice before it, nor the slice by the whole ladder.
    expect(runs.map((run) => levelsOf(run))).toEqual([
      [BANK_LEVELS[0], BANK_LEVELS[1]],
      [BANK_LEVELS[2], BANK_LEVELS[3]],
      [...BANK_LEVELS],
    ]);
  });

  it('reuses the run of the same levels within one ladder object', async () => {
    const { ladder, runs } = recorded();
    await runLadder(ladder, { seed: 1, root: ROOT, maxLevel: 2 });
    await runLadder(ladder, { seed: 1, root: ROOT, maxLevel: 2 });
    expect(runs).toHaveLength(1);
  });
});
