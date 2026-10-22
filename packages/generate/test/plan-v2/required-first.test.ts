import { describe, expect, it } from 'vitest';
import { type PlanV2Row, planV2, renderPlanV2 } from '../../src/plan-v2';
import { makeStore } from './helpers';

/**
 * A harbour whose rare values must be tested: `fog` (3 of 100 on the tide) and `ice` (1 of 100 on the lamp) are
 * required, the rest are common. Names are invented for these tests.
 */
const harbour = () =>
  makeStore([
    {
      id: 'tide',
      values: [
        { id: 'ebb', weight: 60 },
        { id: 'flood', weight: 37 },
        { id: 'fog', weight: 3, required: true },
      ],
    },
    {
      id: 'vessel',
      values: [
        { id: 'ferry', weight: 70 },
        { id: 'trawler', weight: 30 },
      ],
    },
    {
      id: 'lamp',
      values: [
        { id: 'steady', weight: 99 },
        { id: 'ice', weight: 1, required: true },
      ],
    },
  ]);

const REQUIRED = [
  ['tide', 'fog'],
  ['lamp', 'ice'],
] as const;
const holdsRequired = (row: PlanV2Row) =>
  REQUIRED.some(([variable, value]) => row.values[variable] === value);
const planned = (rows: readonly PlanV2Row[]) => rows.filter((row) => row.source === 'planned');
const warned = (plan: ReturnType<typeof planV2>) =>
  plan.warnings.filter((entry) => (entry.code as string) === 'budget_drops_required');

describe('rows that hold a required value come first', () => {
  const plan = planV2(harbour());
  const rows = planned(plan.rows);

  it('puts every row with a required value ahead of every row without one', () => {
    const firstPlain = rows.findIndex((row) => !holdsRequired(row));
    expect(firstPlain).toBeGreaterThan(0);
    expect(rows.slice(firstPlain).some(holdsRequired)).toBe(false);
  });

  it('keeps each group from the most common row to the rarest', () => {
    for (const group of [rows.filter(holdsRequired), rows.filter((row) => !holdsRequired(row))])
      group.forEach((row, at) => {
        if (at > 0)
          expect((group[at - 1] as PlanV2Row).logWeight).toBeGreaterThanOrEqual(row.logWeight - 1e-9);
      });
  });

  it('numbers the rows in the order it returns them', () => {
    expect(rows.map((row) => row.id)).toEqual(rows.map((_, at) => `row.${String(at + 1).padStart(3, '0')}`));
  });

  it('plans the same rows as before, only in another order', () => {
    expect(plan.generated).toBe(rows.length);
    expect(plan.cut).toBe(0);
    expect(warned(plan)).toEqual([]);
  });
});

describe('a budget that cuts a required row says so', () => {
  const whole = planV2(harbour());
  const inFirst = (count: number) =>
    planned(whole.rows)
      .slice(0, count)
      .flatMap((row) => REQUIRED.filter(([variable, value]) => row.values[variable] === value));

  it('keeps a prefix of the ordered plan', () => {
    const cut = planV2(harbour(), { budget: 3 });
    expect(cut.rows.map((row) => row.values)).toEqual(whole.rows.slice(0, 3).map((row) => row.values));
    expect(cut.cut).toBe(whole.generated - 3);
  });

  it('warns budget_drops_required for each required value left in no row', () => {
    let budget = 0;
    while (budget < whole.rows.length && new Set(inFirst(budget).map(([, value]) => value)).size < 2)
      budget += 1;
    expect(budget).toBeGreaterThan(1);
    const short = planV2(harbour(), { budget: budget - 1 });
    const [warning] = warned(short) as unknown as Array<{
      values: Array<{ variable: string; value: string }>;
    }>;
    expect(warning?.values.length).toBeGreaterThan(0);
    const kept = new Set(
      short.rows.flatMap((row) => Object.entries(row.values).map(([k, v]) => `${k}=${v}`)),
    );
    for (const { variable, value } of warning?.values ?? [])
      expect(kept.has(`${variable}=${value}`)).toBe(false);
  });

  it('does not warn when the budget keeps every required value', () => {
    const wide = planV2(harbour(), { budget: whole.rows.length });
    expect(warned(wide)).toEqual([]);
    expect(wide.rows).toEqual(whole.rows);
  });

  it('counts a required value a seed holds as kept', () => {
    const seeds = [{ id: 'real', values: { tide: 'fog', lamp: 'ice', vessel: 'ferry' } }];
    const plan = planV2(harbour(), { seeds, budget: 1 });
    expect(warned(plan)).toEqual([]);
  });
});

describe('a store with no required value', () => {
  it('keeps the order of traffic and warns of nothing', () => {
    const store = makeStore([
      {
        id: 'tide',
        values: [
          { id: 'ebb', weight: 3 },
          { id: 'flood', weight: 1 },
        ],
      },
      { id: 'lamp', values: ['steady', 'flashing'] },
    ]);
    const plan = planV2(store, { budget: 2 });
    const rows = planned(plan.rows);
    rows.forEach((row, at) => {
      if (at > 0) expect((rows[at - 1] as PlanV2Row).logWeight).toBeGreaterThanOrEqual(row.logWeight - 1e-9);
    });
    expect(warned(plan)).toEqual([]);
  });
});

describe('the log weight of a row', () => {
  it('stays minus infinity in memory and null in the JSON text for a value of weight 0', () => {
    const store = makeStore([
      {
        id: 'tide',
        values: [
          { id: 'ebb', weight: 1 },
          { id: 'dead', weight: 0, required: true },
        ],
      },
      { id: 'lamp', values: ['steady', 'flashing'] },
    ]);
    const plan = planV2(store);
    const zero = plan.rows.find((row) => row.values.tide === 'dead');
    expect(zero?.logWeight).toBe(Number.NEGATIVE_INFINITY);
    const text = JSON.parse(renderPlanV2(plan)) as {
      rows: Array<{ values: Record<string, string>; logWeight: number | null }>;
    };
    expect(text.rows.find((row) => row.values.tide === 'dead')?.logWeight).toBeNull();
  });
});
