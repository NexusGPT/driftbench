import { validateVariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { planV2, renderPlanV2 } from '../../src/plan-v2';
import { makeStore, type VariableSpec } from './helpers';

describe('the traffic weight of a row', () => {
  it('is the sum of the logarithms of the shares of its values', () => {
    const store = makeStore([
      {
        id: 'tide',
        values: [
          { id: 'ebb', weight: 60 },
          { id: 'flood', weight: 15 },
          { id: 'slack', weight: 25 },
        ],
      },
      { id: 'lamp', values: ['steady', 'flashing'] },
    ]);
    const plan = planV2(store);
    const share = { ebb: 0.6, flood: 0.15, slack: 0.25 } as const;
    for (const row of plan.rows)
      expect(row.logWeight).toBeCloseTo(
        Math.log(share[row.values.tide as keyof typeof share]) + Math.log(0.5),
        12,
      );
  });

  it('reads weights as relative: 0.6, 0.15, 0.25 and 60, 15, 25 give the same plan', () => {
    const make = (scale: number) =>
      makeStore([
        {
          id: 'tide',
          values: [
            { id: 'ebb', weight: 0.6 * scale },
            { id: 'flood', weight: 0.15 * scale },
            { id: 'slack', weight: 0.25 * scale },
          ],
        },
        { id: 'lamp', values: ['steady', 'flashing'] },
      ]);
    expect(renderPlanV2(planV2(make(1)))).toBe(renderPlanV2(planV2(make(100))));
  });

  it('weighs every value of a variable alike when it has no weights', () => {
    const plan = planV2(makeStore([{ id: 'tide', values: ['ebb', 'flood', 'slack', 'neap'] }]));
    for (const row of plan.rows) expect(row.logWeight).toBeCloseTo(Math.log(0.25), 12);
  });

  it('refuses a variable whose weights are all 0 with VARIABLES_WEIGHT_ZERO, as the loader does', () => {
    const store = makeStore([
      {
        id: 'tide',
        values: [
          { id: 'ebb', weight: 1 },
          { id: 'flood', weight: 1 },
          { id: 'slack', weight: 1 },
        ],
      },
    ]);
    // The loader refuses a variable whose weights are all 0 (VARIABLES_WEIGHT_ZERO), and so does the planner: one
    // rule through both doors (docs/variables.md, Values).
    for (const value of store.variables[0]?.values ?? []) value.weight = 0;
    expect(() => planV2(store)).toThrow(expect.objectContaining({ code: 'VARIABLES_WEIGHT_ZERO' }));
  });

  it.each([
    { name: 'an approved value of weight 0 and an unapproved one of weight 5', approved: 0, unapproved: 5 },
    { name: 'an approved value and an unapproved one, both of weight 0', approved: 0, unapproved: 0 },
    { name: 'an approved value of weight 5 and an unapproved one of weight 0', approved: 5, unapproved: 0 },
  ])('refuses as the loader does for $name: one set of values', ({ approved, unapproved }) => {
    const store = makeStore([
      {
        id: 'tide',
        values: [
          { id: 'ebb', weight: 1 },
          { id: 'flood', weight: 1, approved: false },
        ],
      },
    ]);
    const [ebb, flood] = store.variables[0]?.values ?? [];
    if (!ebb || !flood) throw new Error('the store lost its values');
    ebb.weight = approved;
    flood.weight = unapproved;
    const loaded = validateVariableStore(store);
    const loaderCodes = loaded.ok ? [] : loaded.errors.map((issue) => issue.code);
    let plannerCode: unknown;
    try {
      planV2(store);
    } catch (error) {
      plannerCode = (error as { code?: unknown }).code ?? 'other';
    }
    expect(loaderCodes.filter((code) => code !== 'VARIABLES_WEIGHT_ZERO')).toEqual([]);
    expect(plannerCode).toBe(loaded.ok ? undefined : 'VARIABLES_WEIGHT_ZERO');
  });

  // The review of 635ac191b (run 39891240226): every approval of the variable (2), of each of two values (approved,
  // not approved, inherited: 9), weight 0 or 1 on each value (4) and approvedOnly true or false (2), 144 stores.
  it('refuses zero weights exactly where the loader does, on all 144 approval and weight combinations', () => {
    const approvals = [true, false, undefined] as const;
    const disagree: string[] = [];
    let count = 0;
    for (const variableApproved of [true, false])
      for (const first of approvals)
        for (const second of approvals)
          for (const weights of [
            [0, 0],
            [0, 1],
            [1, 0],
            [1, 1],
          ] as const)
            for (const approvedOnly of [true, false]) {
              count += 1;
              const store = makeStore([
                { id: 'tide', values: ['ebb', 'flood'] },
                { id: 'lamp', values: ['steady', 'flashing'] },
              ]);
              const [tide] = store.variables;
              if (!tide) throw new Error('the store lost its variable');
              tide.approved = variableApproved;
              tide.values.forEach((value, at) => {
                const approved = at === 0 ? first : second;
                if (approved === undefined) delete value.approved;
                else value.approved = approved;
                value.weight = weights[at];
              });
              const loaded = validateVariableStore(store);
              const loaderCodes = loaded.ok ? [] : loaded.errors.map((issue) => issue.code);
              expect(loaderCodes.filter((code) => code !== 'VARIABLES_WEIGHT_ZERO')).toEqual([]);
              let plannerCode: unknown;
              try {
                planV2(store, { approvedOnly });
              } catch (error) {
                plannerCode =
                  error instanceof RangeError ? (error as { code?: unknown }).code : 'not a RangeError';
              }
              if (plannerCode !== (loaded.ok ? undefined : 'VARIABLES_WEIGHT_ZERO'))
                disagree.push(
                  JSON.stringify({ variableApproved, first, second, weights, approvedOnly, plannerCode }),
                );
            }
    expect(count).toBe(144);
    expect(disagree).toEqual([]);
  });

  it('takes the shares among the approved values only', () => {
    const store = makeStore([
      {
        id: 'tide',
        values: [
          { id: 'ebb', weight: 1 },
          { id: 'flood', weight: 1 },
          { id: 'slack', weight: 8, approved: false },
        ],
      },
    ]);
    for (const row of planV2(store).rows) expect(row.logWeight).toBeCloseTo(Math.log(0.5), 12);
  });

  it('makes a row with a value of weight zero the rarest of all', () => {
    const store = makeStore([
      {
        id: 'tide',
        values: [
          { id: 'ebb', weight: 1 },
          { id: 'flood', weight: 0 },
          { id: 'slack', weight: 1 },
        ],
      },
    ]);
    const plan = planV2(store);
    expect(plan.rows.at(-1)).toMatchObject({
      values: { tide: 'flood' },
      logWeight: Number.NEGATIVE_INFINITY,
    });
    expect(JSON.parse(renderPlanV2(plan)).rows.at(-1).logWeight).toBeNull();
  });

  it('orders rows whose linear weight has underflowed to zero, because it adds logarithms', () => {
    // 200 variables; a value of share 0.97, 0.02 or 0.01 in each. The all-0.02 row weighs 1e-340, the all-0.01 row
    // 1e-400: both are 0 as a product of doubles, and different as sums of logarithms.
    // Details, so that no pair of axes asks for the floor: the test is about the order of rows, not about covering.
    const variables: VariableSpec[] = Array.from({ length: 200 }, (_, at) => ({
      id: `v${at}`,
      role: 'detail' as const,
      values: [
        { id: `v${at}_common`, weight: 97 },
        { id: `v${at}_rare`, weight: 2 },
        { id: `v${at}_rarer`, weight: 1 },
      ],
    }));
    const plan = planV2(makeStore(variables));
    const logs = plan.rows.map((row) => row.logWeight);
    expect(plan.rows).toHaveLength(3);
    expect(logs[0]).toBeCloseTo(200 * Math.log(0.97), 9);
    expect(logs[1]).toBeCloseTo(200 * Math.log(0.02), 9);
    expect(logs[2]).toBeCloseTo(200 * Math.log(0.01), 9);
    expect(logs[1]).toBeGreaterThan(logs[2] as number);
    expect(Math.exp(logs[1] as number)).toBe(0);
    expect(Math.exp(logs[2] as number)).toBe(0);
    expect(plan.rows.map((row) => row.values.v0)).toEqual(['v0_common', 'v0_rare', 'v0_rarer']);
  });

  it('weighs a seed row by the values it names and ignores the rest', () => {
    const store = makeStore([
      {
        id: 'tide',
        values: [
          { id: 'ebb', weight: 1 },
          { id: 'flood', weight: 3 },
        ],
      },
      { id: 'lamp', values: ['steady', 'flashing'] },
    ]);
    const plan = planV2(store, { seeds: [{ id: 'half', values: { tide: 'flood' } }] });
    expect(plan.rows[0]?.logWeight).toBeCloseTo(Math.log(0.75), 12);
  });
});
