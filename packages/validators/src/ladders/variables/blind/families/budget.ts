import type { ItemContext } from '../../bank/item';
import type { Plan, PlanOptions, Row, StoreDoc } from '../../interface';
import {
  allowedTuples,
  allRows,
  assertRowsSound,
  callPlan,
  coveredTuples,
  errorNamed,
  jsonEqual,
  logWeightOf,
  makeStore,
  must,
  names,
  newRows,
  planError,
  requiredGroups,
  type Stem,
  spaceOf,
  valueIds,
} from '../kit';

/** Family budget-order: R9 (traffic weight, order, budget) and R10 (bad budgets raise). */

/** A store of weighted shared axes: each variable lists its weights, or none for uniform shares. */
function weighted(ctx: ItemContext, weights: Array<number[] | null>): { store: StoreDoc; ids: string[] } {
  const ids = names(ctx.rng, weights.length) as string[];
  const store = makeStore({
    vars: ids.map((id, i) => {
      const w = weights[i] ?? null;
      const n = w ? w.length : 3;
      return {
        id,
        shared: true,
        values: valueIds(n).map((v, k) => (w ? { id: v, weight: w[k] as number } : v)),
      };
    }),
  });
  return { store, ids };
}

function order(plan: Plan): number[] {
  return newRows(plan).map((r) => (r.logWeight === null ? Number.NEGATIVE_INFINITY : r.logWeight));
}

function descending(plan: Plan): void {
  const w = order(plan);
  for (let i = 1; i < w.length; i += 1) {
    must(
      (w[i] as number) <= (w[i - 1] as number),
      () =>
        `new row ${i} (logWeight ${String(w[i])}) outweighs new row ${i - 1} (${String(w[i - 1])}): the rows must run from the most common to the rarest`,
    );
  }
}

function prefixHolds(ctx: ItemContext, store: StoreDoc, budget: number, seeds: Row[] = []): void {
  const full = callPlan(ctx, store, { seed: ctx.seed, seeds });
  const cut = callPlan(ctx, store, { seed: ctx.seed, seeds, budget });
  const keep = Math.max(budget, seeds.length);
  must(
    cut.rows.length === Math.min(keep, full.rows.length),
    () => `${cut.rows.length} rows with budget ${budget}; expected ${Math.min(keep, full.rows.length)}`,
  );
  must(
    jsonEqual(cut.rows, full.rows.slice(0, cut.rows.length)),
    () => `the plan with budget ${budget} is not a prefix of the uncut plan`,
  );
}

const badBudget =
  (value: unknown, name: string, kind: 'RangeError' | 'either' = 'RangeError') =>
  (ctx: ItemContext): void => {
    const { store } = weighted(ctx, [null, null]);
    const error = planError(ctx, store, { seed: ctx.seed, budget: value as number });
    if (kind === 'either' && error.name === 'TypeError') errorNamed(error, 'TypeError', name);
    else errorNamed(error, 'RangeError', name);
  };

export const BUDGET_STEMS: readonly Stem[] = [
  {
    id: 'budget.traffic-order',
    rules: ['R9'],
    family: 'budget-order',
    component: 'planner/budget',
    cause:
      'new rows run from the most common to the rarest by the sum of the logarithms of the shares of their values',
    cases: [
      [
        'new-rows-run-most-common-first',
        2,
        (ctx) => {
          const { store } = weighted(ctx, [[0.7, 0.2, 0.1], [0.5, 0.3, 0.2], [0.6, 0.3, 0.1], null]);
          descending(callPlan(ctx, store, { seed: ctx.seed }));
        },
      ],
      [
        'log-weight-is-the-sum-of-log-shares',
        2,
        (ctx) => {
          const { store } = weighted(ctx, [[6, 3, 1], [1, 1, 2], null]);
          const space = spaceOf(store);
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          assertRowsSound(space, plan, []);
          for (const r of newRows(plan)) {
            const want = logWeightOf(space, r.values) as number;
            must(
              r.logWeight !== null && Math.abs(r.logWeight - want) <= 1e-8,
              () => `row ${r.id} has logWeight ${String(r.logWeight)}; the sum of the log shares is ${want}`,
            );
          }
        },
      ],
      [
        'log-weight-is-written-to-nine-places',
        3,
        (ctx) => {
          const { store } = weighted(ctx, [
            [7, 3, 5],
            [2, 9, 4],
            [1, 1, 1],
          ]);
          for (const r of callPlan(ctx, store, { seed: ctx.seed }).rows) {
            must(
              r.logWeight === null || r.logWeight === Number(r.logWeight.toFixed(9)),
              () => `logWeight ${String(r.logWeight)} of ${r.id} has more than nine places`,
            );
          }
        },
      ],
      [
        'uniform-shares-when-a-variable-has-no-weights',
        2,
        (ctx) => {
          const { store } = weighted(ctx, [null, null]);
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          for (const r of newRows(plan)) {
            must(
              r.logWeight !== null && Math.abs(r.logWeight - 2 * Math.log(1 / 3)) <= 1e-8,
              () =>
                `row ${r.id} has logWeight ${String(r.logWeight)}; two uniform ternary shares give ${2 * Math.log(1 / 3)}`,
            );
          }
        },
      ],
      [
        'weights-are-relative',
        3,
        (ctx) => {
          const small = weighted(ctx, [
            [0.6, 0.15, 0.25],
            [0.5, 0.5],
          ]);
          const big = JSON.parse(JSON.stringify(small.store)) as StoreDoc;
          for (const v of big.variables) for (const x of v.values) x.weight = (x.weight as number) * 100;
          const a = callPlan(ctx, small.store, { seed: ctx.seed });
          const b = callPlan(ctx, big, { seed: ctx.seed });
          must(
            jsonEqual(a.rows, b.rows),
            () => 'weights 0.6, 0.15, 0.25 and 60, 15, 25 gave different plans',
          );
        },
      ],
      [
        'weight-zero-is-minus-infinity-and-last',
        3,
        (ctx) => {
          const { store, ids } = weighted(ctx, [
            [3, 1, 0],
            [1, 1],
          ]);
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          const zero = newRows(plan).filter((r) => r.values[ids[0] as string] === 'v2');
          must(
            zero.length >= 1,
            () => 'no row holds the value of weight 0, but it is still a value of the store',
          );
          for (const r of zero)
            must(
              r.logWeight === null,
              () =>
                `row ${r.id} holds a weight 0 value and has logWeight ${String(r.logWeight)}; expected null`,
            );
          descending(plan);
          const lastZero = newRows(plan)
            .map((r) => r.logWeight === null)
            .lastIndexOf(false);
          must(
            newRows(plan)
              .slice(lastZero + 1)
              .every((r) => r.logWeight === null),
            () => 'a row of weight 0 comes before a row of positive weight',
          );
        },
      ],
      [
        'unapproved-values-leave-the-denominator',
        4,
        (ctx) => {
          const ids = names(ctx.rng, 2) as string[];
          const store = makeStore({
            vars: [
              {
                id: ids[0] as string,
                shared: true,
                values: [
                  { id: 'v0', weight: 1 },
                  { id: 'v1', weight: 1 },
                  { id: 'proposed', weight: 8, approved: false },
                ],
              },
              {
                id: ids[1] as string,
                shared: true,
                values: [
                  { id: 'v0', weight: 1 },
                  { id: 'v1', weight: 1 },
                ],
              },
            ],
          });
          for (const r of newRows(callPlan(ctx, store, { seed: ctx.seed }))) {
            must(
              r.logWeight !== null && Math.abs(r.logWeight - 2 * Math.log(0.5)) <= 1e-8,
              () =>
                `row ${r.id} has logWeight ${String(r.logWeight)}; both shares are 1/2, so ${2 * Math.log(0.5)}`,
            );
          }
        },
      ],
      [
        'unweighted-variable-beside-a-weighted-one',
        3,
        (ctx) => {
          const { store, ids } = weighted(ctx, [[8, 1, 1], null]);
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          for (const r of newRows(plan)) {
            const want = Math.log(r.values[ids[0] as string] === 'v0' ? 0.8 : 0.1) + Math.log(1 / 3);
            must(
              r.logWeight !== null && Math.abs(r.logWeight - want) <= 1e-8,
              () => `row ${r.id}: logWeight ${String(r.logWeight)}, expected ${want}`,
            );
          }
        },
      ],
      [
        'shares-below-the-float-floor-keep-their-order',
        5,
        (ctx) => {
          // 400 details whose product of shares is far below the smallest double: logs keep rows ordered and finite.
          const ids = names(ctx.rng, 400) as string[];
          const store = makeStore({
            vars: ids.map((id) => ({
              id,
              values: [
                { id: 'v0', weight: 1 },
                { id: 'v1', weight: 998 },
                { id: 'v2', weight: 1 },
              ],
            })),
          });
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          for (const r of newRows(plan))
            must(
              r.logWeight !== null && Number.isFinite(r.logWeight),
              () =>
                `row ${r.id} has logWeight ${String(r.logWeight)}; products of shares must be compared in log space`,
            );
          descending(plan);
          const w = order(plan);
          must(
            new Set(w).size > 1,
            () => 'every row has the same logWeight although the values differ in weight a thousand-fold',
          );
        },
      ],
      [
        'seed-rows-carry-a-log-weight',
        3,
        (ctx) => {
          const { store, ids } = weighted(ctx, [
            [1, 3],
            [2, 2, 1],
          ]);
          const seed: Row = { [ids[0] as string]: 'v1', [ids[1] as string]: 'v2' };
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds: [seed] });
          const want = Math.log(3 / 4) + Math.log(1 / 5);
          const lw = plan.rows[0]?.logWeight;
          must(
            typeof lw === 'number' && Math.abs(lw - want) <= 1e-8,
            () => `the seed row has logWeight ${String(lw)}; expected ${want}`,
          );
        },
      ],
      [
        'rare-seed-stays-first',
        3,
        (ctx) => {
          const { store, ids } = weighted(ctx, [
            [100, 1],
            [100, 1],
          ]);
          const seed: Row = { [ids[0] as string]: 'v1', [ids[1] as string]: 'v1' };
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds: [seed] });
          must(
            plan.rows[0]?.kind === 'seed',
            () => 'the rarest possible row is a seed and must still come first',
          );
        },
      ],
    ],
  },
  {
    id: 'budget.cut',
    rules: ['R9'],
    family: 'budget-order',
    component: 'planner/budget',
    cause:
      'a budget counts every row, seeds included, and keeps a prefix of the uncut plan, so the rarest rows are cut first',
    cases: [
      ['budget-one', 2, (ctx) => prefixHolds(ctx, weighted(ctx, [[5, 3, 2], [4, 4, 2], null]).store, 1)],
      ['budget-three', 2, (ctx) => prefixHolds(ctx, weighted(ctx, [[5, 3, 2], [4, 4, 2], null]).store, 3)],
      [
        'budget-half-of-the-plan',
        2,
        (ctx) => {
          const { store } = weighted(ctx, [[5, 3, 2], [4, 4, 2], [1, 2, 3], null]);
          const full = callPlan(ctx, store, { seed: ctx.seed });
          prefixHolds(ctx, store, Math.floor(full.rows.length / 2));
        },
      ],
      [
        'budget-one-below-the-plan',
        3,
        (ctx) => {
          const { store } = weighted(ctx, [
            [5, 3, 2],
            [4, 4, 2],
            [1, 2, 3],
          ]);
          const full = callPlan(ctx, store, { seed: ctx.seed });
          prefixHolds(ctx, store, full.rows.length - 1);
        },
      ],
      [
        'budget-equal-to-the-plan',
        3,
        (ctx) => {
          const { store } = weighted(ctx, [
            [5, 3, 2],
            [4, 4, 2],
            [1, 2, 3],
          ]);
          const full = callPlan(ctx, store, { seed: ctx.seed });
          prefixHolds(ctx, store, full.rows.length);
        },
      ],
      [
        'budget-above-the-plan',
        2,
        (ctx) => {
          const { store } = weighted(ctx, [
            [5, 3, 2],
            [4, 4, 2],
          ]);
          prefixHolds(ctx, store, 10_000);
        },
      ],
      [
        'budget-counts-the-seeds',
        3,
        (ctx) => {
          const { store, ids } = weighted(ctx, [[5, 3, 2], [4, 4, 2], null]);
          const seeds: Row[] = [
            { [ids[0] as string]: 'v1', [ids[1] as string]: 'v0' },
            { [ids[2] as string]: 'v2' },
          ];
          prefixHolds(ctx, store, 5, seeds);
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds, budget: 5 });
          must(
            plan.rows.length === 5 && plan.rows.slice(0, 2).every((r) => r.kind === 'seed'),
            () => `${plan.rows.length} rows with 2 seeds and budget 5`,
          );
        },
      ],
      [
        'budget-below-the-seed-count-keeps-every-seed',
        3,
        (ctx) => {
          const { store, ids } = weighted(ctx, [
            [5, 3, 2],
            [4, 4, 2],
          ]);
          const seeds: Row[] = [0, 1, 2, 0].map((k) => ({
            [ids[0] as string]: `v${k}`,
            [ids[1] as string]: `v${k % 2}`,
          }));
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds, budget: 2 });
          must(
            plan.rows.length === 4 && plan.rows.every((r) => r.kind === 'seed'),
            () =>
              `${plan.rows.length} rows with 4 seeds and budget 2; the seeds stay and no new row joins them`,
          );
        },
      ],
      [
        'budget-equal-to-the-seed-count-adds-no-row',
        3,
        (ctx) => {
          const { store, ids } = weighted(ctx, [
            [5, 3, 2],
            [4, 4, 2],
          ]);
          const seeds: Row[] = [
            { [ids[0] as string]: 'v0', [ids[1] as string]: 'v0' },
            { [ids[0] as string]: 'v1', [ids[1] as string]: 'v1' },
          ];
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds, budget: 2 });
          must(plan.rows.length === 2, () => `${plan.rows.length} rows with 2 seeds and budget 2`);
        },
      ],
      [
        'zero-budget-without-seeds',
        2,
        (ctx) => {
          const { store } = weighted(ctx, [
            [5, 3, 2],
            [4, 4, 2],
          ]);
          const plan = callPlan(ctx, store, { seed: ctx.seed, budget: 0 });
          must(plan.rows.length === 0, () => `${plan.rows.length} rows with budget 0 and no seeds`);
        },
      ],
      [
        'zero-budget-with-seeds',
        3,
        (ctx) => {
          const { store, ids } = weighted(ctx, [
            [5, 3, 2],
            [4, 4, 2],
          ]);
          const seeds: Row[] = [{ [ids[0] as string]: 'v2', [ids[1] as string]: 'v1' }];
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds, budget: 0 });
          must(
            plan.rows.length === 1 && plan.rows[0]?.kind === 'seed',
            () => `${plan.rows.length} rows with one seed and budget 0`,
          );
        },
      ],
      [
        'the-cut-drops-the-rarest-rows',
        3,
        (ctx) => {
          const { store } = weighted(ctx, [
            [9, 2, 1],
            [6, 3, 1],
            [5, 4, 1],
          ]);
          const full = callPlan(ctx, store, { seed: ctx.seed });
          const budget = Math.max(2, Math.floor(full.rows.length / 2));
          const cut = callPlan(ctx, store, { seed: ctx.seed, budget });
          const kept = order(cut);
          const dropped = order(full).slice(kept.length);
          must(dropped.length > 0, () => 'the item expects a cut to drop at least one row');
          must(
            Math.max(...dropped) <= Math.min(...kept),
            () => 'a dropped row is more common than a kept row: the cut must remove the rarest rows first',
          );
        },
      ],
      [
        'cut-plan-reports-what-its-rows-hold',
        4,
        (ctx) => {
          const { store } = weighted(ctx, [
            [5, 3, 2],
            [4, 4, 2],
            [1, 2, 3],
          ]);
          const space = spaceOf(store);
          const cut = callPlan(ctx, store, { seed: ctx.seed, budget: 3 });
          must(!!cut.report, () => 'a cut plan has no coverage report');
          const groups = requiredGroups(space);
          const allowed = allowedTuples(space, groups, allRows(space));
          const { covered } = coveredTuples(
            groups,
            allowed,
            cut.rows.map((r) => r.values),
            space,
          );
          const report = cut.report as NonNullable<Plan['report']>;
          must(
            Number(report.allowed) === allowed.size,
            () => `report.allowed ${String(report.allowed)} against ${allowed.size}`,
          );
          must(
            Number(report.covered) === covered.size && covered.size < allowed.size,
            () =>
              `report.covered ${String(report.covered)}; the three kept rows hold ${covered.size} of ${allowed.size}`,
          );
        },
      ],
      [
        'same-budget-same-bytes',
        3,
        (ctx) => {
          const { store } = weighted(ctx, [
            [5, 3, 2],
            [4, 4, 2],
            [1, 2, 3],
          ]);
          const opts: PlanOptions = { seed: ctx.seed, budget: 4 };
          const first = JSON.stringify(callPlan(ctx, store, opts));
          const second = JSON.stringify(callPlan(ctx, store, opts));
          must(first === second, () => 'the same budget gave different bytes');
        },
      ],
    ],
  },
  {
    id: 'budget.errors',
    rules: ['R10'],
    family: 'budget-order',
    component: 'planner/budget',
    cause: 'a budget that is not a non-negative whole number raises an error that names budget',
    cases: [
      ['negative', 2, badBudget(-1, 'budget')],
      ['large-negative', 2, badBudget(-1000, 'budget')],
      ['fractional', 2, badBudget(2.5, 'budget')],
      ['tiny-fraction', 3, badBudget(0.0001, 'budget')],
      ['not-a-number', 3, badBudget(Number.NaN, 'budget')],
      ['infinity', 3, badBudget(Number.POSITIVE_INFINITY, 'budget')],
      ['negative-infinity', 3, badBudget(Number.NEGATIVE_INFINITY, 'budget')],
      ['text', 3, badBudget('ten', 'budget', 'either')],
      [
        'a-bad-budget-with-seeds',
        4,
        (ctx) => {
          const { store, ids } = weighted(ctx, [null, null]);
          const error = planError(ctx, store, {
            seed: ctx.seed,
            budget: -3,
            seeds: [{ [ids[0] as string]: 'v0' }],
          });
          errorNamed(error, 'RangeError', 'budget');
        },
      ],
    ],
  },
  {
    id: 'budget.ties',
    rules: ['R9'],
    family: 'budget-order',
    component: 'planner/budget',
    cause: 'rows of equal weight come in an order fixed by the seed',
    cases: [
      [
        'equal-weights-stable-order',
        3,
        (ctx) => {
          const { store } = weighted(ctx, [null, null, null]);
          const a = callPlan(ctx, store, { seed: ctx.seed });
          const b = callPlan(ctx, store, { seed: ctx.seed });
          must(jsonEqual(a.rows, b.rows), () => 'rows of equal weight changed order between two equal calls');
        },
      ],
      [
        'any-plan-seed-gives-a-sound-ordered-plan',
        2,
        (ctx) => {
          const { store } = weighted(ctx, [
            [5, 3, 2],
            [4, 4, 2],
            [1, 2, 3],
          ]);
          for (const seed of [1, 2, 3, 99]) {
            const plan = callPlan(ctx, store, { seed });
            assertRowsSound(spaceOf(store), plan, []);
            descending(plan);
          }
        },
      ],
    ],
  },
];
