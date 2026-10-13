import { expect, it } from 'vitest';
import * as stats from '../../stats/src/index';
import { itemRng } from '../src/ladders/stats/bank/item';
import { rateItems } from '../src/ladders/stats/bank/rates';

it.each([
  [30, 362983924],
  [30, 132],
  [100, 101],
])('retains the unchanged coverage bar at n=%i, regression seed %i', async (n, seed) => {
  const id = `simulation.newcombe.n${n}`;
  const item = rateItems().find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Missing ${id}`);
  const outcome = await item.check({ seed, s: stats, root: process.cwd(), rng: itemRng(seed, id) });
  expect(outcome.pass, outcome.detail).toBe(true);
});
