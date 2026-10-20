import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clopperAlphaItems } from '../../src/ladders/stats/bank/exact-clopper-alpha';
import { runItem, statsBank } from '../../src/ladders/stats/bank/index';
import type { StatsImpl } from '../../src/ladders/stats/reference';
import { ROOT, real } from './support';

const items = clopperAlphaItems();
const fixture = JSON.parse(
  readFileSync(join(ROOT, 'packages/validators/fixtures/stats/exact-clopper-alpha.json'), 'utf8'),
) as Record<
  string,
  Array<{ k: number; n: number; alpha: number; expected: { lower: number; upper: number } }>
>;
const cases = Object.entries(fixture)
  .filter(([key]) => key.startsWith('clopperPearson.'))
  .flatMap(([, rows]) => rows);

/** The interval the reference gives, looked up by its inputs: the answer a correct product returns. */
const oracle = {
  ...real,
  clopperPearson: (k: number, n: number, alpha: number) => {
    const row = cases.find((c) => c.k === k && c.n === n && c.alpha === alpha);
    if (!row) throw new Error(`no reference for k=${k} n=${n} alpha=${alpha}`);
    return { estimate: k / n, ...row.expected };
  },
} as unknown as StatsImpl;

/** True once the product keeps the log tail: at Number.MIN_VALUE the interval is not the whole range. */
const productKeepsLogTail = (real.clopperPearson(50, 100, Number.MIN_VALUE).upper as number) < 1;

it('registers six clopperPearson items under one shared cause, in the bank', () => {
  expect(items).toHaveLength(6);
  expect(new Set(items.map((item) => item.cause)).size).toBe(1);
  const ids = new Set(statsBank(ROOT).map((item) => item.id));
  for (const item of items) expect(ids.has(item.id), item.id).toBe(true);
});

it('has the limits for three ranges of alpha, nine counts each', () => {
  expect(Object.keys(fixture).filter((key) => key.startsWith('clopperPearson.'))).toEqual([
    'clopperPearson.alpha-min',
    'clopperPearson.alpha-subnormal',
    'clopperPearson.alpha-small-normal',
  ]);
  expect(fixture['clopperPearson.alpha-min']).toHaveLength(9);
  expect(fixture['clopperPearson.alpha-subnormal']).toHaveLength(18);
  expect(fixture['clopperPearson.alpha-small-normal']).toHaveLength(18);
});

describe('the clopperPearson items at extreme alpha', () => {
  it.each(items)('$id accepts the reference interval', async (item) => {
    const result = await runItem(item, 1, ROOT, oracle);
    expect(result.pass, result.detail).toBe(true);
  });

  // alpha / 2 is a normal double above 1e-300: the halving is exact there, so the smallest normal range holds on a
  // product that halves alpha first. These two items are guards; the other four fail until the tail is taken in log space.
  it.each(items)('$id agrees with the product exactly when it should', async (item) => {
    const result = await runItem(item, 1, ROOT, real);
    expect(result.pass, result.detail).toBe(productKeepsLogTail || item.id.includes('alpha-small-normal'));
  });

  it.each(items)('$id rejects an interval that is the whole range, and a throw', async (item) => {
    const whole = {
      ...real,
      clopperPearson: (k: number, n: number) => ({ estimate: k / n, lower: 0, upper: 1 }),
    };
    const result = await runItem(item, 1, ROOT, whole as unknown as StatsImpl);
    expect(result.pass).toBe(false);
    const thrown = {
      ...real,
      clopperPearson: () => {
        throw new Error('planted throw');
      },
    };
    expect((await runItem(item, 1, ROOT, thrown as unknown as StatsImpl)).pass).toBe(false);
  });

  it.each(items)('$id rejects a limit that is off by 0.1 percent', async (item) => {
    const side = item.id.endsWith('lower') ? 'lower' : 'upper';
    const nudged = {
      ...oracle,
      clopperPearson: (k: number, n: number, alpha: number) => {
        const interval = (
          oracle as unknown as { clopperPearson: (...a: number[]) => Record<string, number> }
        ).clopperPearson(k, n, alpha);
        const value = interval[side] as number;
        // A limit of 0 or 1 has no relative error to plant; step it to the nearest value inside the range.
        return { ...interval, [side]: value === 0 ? 1e-9 : value === 1 ? 1 - 1e-9 : value * 1.001 };
      },
    };
    expect((await runItem(item, 1, ROOT, nudged as unknown as StatsImpl)).pass).toBe(false);
  });

  it('every item names the function, the file and a cause an executor can act on', () => {
    for (const item of items) {
      expect(item.component).toBe('packages/stats/src/intervals.ts');
      expect(item.cause).toContain('log space');
    }
  });
});
