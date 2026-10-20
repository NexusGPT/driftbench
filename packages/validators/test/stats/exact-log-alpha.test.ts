import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { logAlphaItems } from '../../src/ladders/stats/bank/exact-log-alpha';
import { runItem, statsBank } from '../../src/ladders/stats/bank/index';
import type { StatsImpl } from '../../src/ladders/stats/reference';
import { ROOT, real } from './support';

const items = logAlphaItems();
type Fn = (...args: unknown[]) => unknown;

function nudge(value: unknown): unknown {
  if (typeof value === 'number') return value * 1.002;
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, nudge(item)]));
  return value;
}

it('registers twelve log-alpha cases under one shared cause', () => {
  expect(items).toHaveLength(12);
  expect(new Set(items.map((item) => item.cause)).size).toBe(1);
  const ids = new Set(statsBank(ROOT).map((item) => item.id));
  for (const item of items) expect(ids.has(item.id), item.id).toBe(true);
});

describe('two-sided log-tail capabilities', () => {
  it.each(items)('$id passes the product against independent high-precision references', async (item) => {
    const result = await runItem(item, 1, ROOT, real);
    expect(result.pass, result.detail).toBe(true);
  });

  it.each(items)('$id rejects a changed 0.2% output and a throw', async (item) => {
    const name = item.id.split('.')[1] as string;
    const original = (real as unknown as Record<string, Fn>)[name] as Fn;
    let changed = false;
    const mutant = {
      ...real,
      [name]: (...args: unknown[]) => {
        const output = original(...args);
        const wrong = nudge(output);
        expect(isDeepStrictEqual(output, wrong), 'a no-op does not prove sensitivity').toBe(false);
        changed = true;
        return wrong;
      },
    } as StatsImpl;
    expect((await runItem(item, 1, ROOT, mutant)).pass).toBe(false);
    expect(changed).toBe(true);
    const thrown = {
      ...real,
      [name]: () => {
        throw new Error('planted throw');
      },
    } as StatsImpl;
    expect((await runItem(item, 1, ROOT, thrown)).pass).toBe(false);
  });

  it.each(items.filter((item) => item.id.includes('sampleSizeForEffect')))(
    '$id rejects a correct sample count plus 1e-10',
    async (item) => {
      const fixtures = JSON.parse(
        readFileSync(join(ROOT, 'packages/validators/fixtures/stats/exact-log-alpha.json'), 'utf8'),
      );
      const expected = fixtures[item.id.slice('exact.'.length)][0].expected;
      const mutant = {
        ...real,
        sampleSizeForEffect: () => ({ ...expected, n: expected.n + 1e-10 }),
      } as StatsImpl;
      const result = await runItem(item, 1, ROOT, mutant);
      expect(result.pass).toBe(false);
      expect(result.detail).toContain('integer');
    },
  );
});
