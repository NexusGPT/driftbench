import type { ItemContext } from '../../bank/item';
import type { Plan, Row, StoreDoc } from '../../interface';
import {
  allowedTuples,
  allRows,
  assertCovered,
  assertRowsSound,
  callPlan,
  coveredTuples,
  jsonEqual,
  logWeightOf,
  makeStore,
  must,
  names,
  newRows,
  requiredGroups,
  type Stem,
  sameRow,
  show,
  spaceOf,
  valueIds,
} from '../kit';

/**
 * Differential property items: a small random store per seed, built so that two documented rules meet, and a
 * brute force oracle (the full valid rows of the space) that decides what the plan must hold. Each case is one
 * meeting of rules (docs/variables.md R6 to R9 and R12), so a planner that gets one rule right alone can still
 * fail the case where it meets another.
 */

const at = (list: readonly string[], i: number): string => list[i] as string;

/** Plans the store, then checks the rows are sound and every allowed required tuple is held. */
function planOk(ctx: ItemContext, store: StoreDoc, seeds: Row[] = []): Plan {
  const space = spaceOf(store);
  const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
  assertRowsSound(space, plan, seeds);
  assertCovered(space, plan, seeds);
  return plan;
}

function codes(plan: Plan): string[] {
  return (plan.warnings ?? []).map((w) => w.code);
}

/** The report of a plan against the brute force counts of allowed and held required tuples. */
function reportMatches(ctx: ItemContext, store: StoreDoc, seeds: Row[] = []): void {
  const space = spaceOf(store);
  const groups = requiredGroups(space);
  const allowed = allowedTuples(space, groups, allRows(space));
  const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
  must(!!plan.report, () => 'the plan has no coverage report');
  const report = plan.report as NonNullable<Plan['report']>;
  const { covered } = coveredTuples(
    groups,
    allowed,
    plan.rows.map((r) => r.values),
    space,
  );
  must(
    Number(report.allowed) === allowed.size,
    () => `report.allowed is ${String(report.allowed)}; the allowed required tuples number ${allowed.size}`,
  );
  must(
    Number(report.covered) === covered.size,
    () => `report.covered is ${String(report.covered)}; the rows hold ${covered.size} of them`,
  );
}

/** Four shared axes of three values, the second with one value nobody approved. */
function axesWithUnapprovedValue(ctx: ItemContext): { store: StoreDoc; ids: string[] } {
  const ids = names(ctx.rng, 4);
  const store = makeStore({
    vars: ids.map((id, i) => ({
      id,
      shared: true,
      values: i === 1 ? ['v0', 'v1', { id: 'v2', approved: false }] : valueIds(3),
    })),
  });
  return { store, ids };
}

/** The pair-of-pairs space: A=v0 excludes B=v0 and C=v0 excludes B=v1, so (A=v0, C=v0) has no valid row. */
function chainedPairs(ctx: ItemContext): StoreDoc {
  const ids = names(ctx.rng, 4);
  return makeStore({
    vars: [
      { id: at(ids, 0), values: valueIds(3), shared: true },
      { id: at(ids, 1), values: valueIds(2), shared: true },
      { id: at(ids, 2), values: valueIds(3), shared: true },
      { id: at(ids, 3), values: valueIds(2), shared: true },
    ],
    impossible: [
      [at(ids, 0), 'v0', at(ids, 1), 'v0'],
      [at(ids, 2), 'v0', at(ids, 1), 'v1'],
    ],
  });
}

function twoRulesWithPair(ctx: ItemContext): StoreDoc {
  const ids = names(ctx.rng, 6);
  return makeStore({
    vars: ids.map((id, i) => ({ id, values: valueIds(i % 2 === 0 ? 2 : 3) })),
    rules: [
      { id: 'rule.p', variables: ids.slice(0, 4) },
      { id: 'rule.q', variables: ids.slice(2, 6) },
    ],
    impossible: [[at(ids, 2), 'v0', at(ids, 3), 'v1']],
  });
}

/** Four variables whose weights are given; `undefined` leaves a variable unweighted. */
function weighted(
  ids: string[],
  weights: Array<number[] | undefined>,
  extra: Partial<Parameters<typeof makeStore>[0]> = {},
): StoreDoc {
  return makeStore({
    vars: ids.map((id, i) => {
      const w = weights[i];
      return { id, values: valueIds(3).map((v, j) => (w ? { id: v, weight: w[j] as number } : v)) };
    }),
    ...extra,
  });
}

function drawWeights(ctx: ItemContext, count: number, zero = false): number[][] {
  return Array.from({ length: count }, (_, i) =>
    Array.from({ length: 3 }, (_, j) => (zero && i === 0 && j === 2 ? 0 : ctx.rng.int(1, 9))),
  );
}

/** New rows run most common first, a zero weight last, and each logWeight is the sum of the logs of the shares. */
function checkOrder(store: StoreDoc, plan: Plan): void {
  const space = spaceOf(store);
  let last = Number.POSITIVE_INFINITY;
  let sawNull = false;
  for (const row of newRows(plan)) {
    const expected = logWeightOf(space, row.values);
    if (expected === null) {
      must(
        row.logWeight === null,
        () => `the row ${row.id} holds a zero weight and has logWeight ${show(row.logWeight)}`,
      );
      sawNull = true;
      continue;
    }
    must(!sawNull, () => `the row ${row.id} has a finite weight and follows a row of zero weight`);
    must(
      typeof row.logWeight === 'number' && Math.abs(row.logWeight - expected) < 1e-8,
      () => `the row ${row.id} has logWeight ${show(row.logWeight)}; its shares give ${expected.toFixed(9)}`,
    );
    must(row.logWeight <= last + 1e-12, () => `the row ${row.id} is rarer than the row after it`);
    last = row.logWeight;
  }
}

export const PROPERTY_STEMS: readonly Stem[] = [
  {
    id: 'diff.cover',
    rules: ['R6', 'R7'],
    family: 'strength',
    component: 'planner/strength',
    cause: 'the plan covers every allowed required tuple of a store where two of the rules of R6 and R7 meet',
    cases: [
      [
        'three-entry-forbid-inside-a-rule',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 5);
          planOk(
            ctx,
            makeStore({
              vars: ids.map((id, i) => ({ id, values: valueIds(i < 4 ? 3 : 2) })),
              rules: [{ id: 'rule.main', variables: ids.slice(0, 4) }],
              forbids: [{ forbid: { [at(ids, 0)]: 'v0', [at(ids, 1)]: 'v1', [at(ids, 2)]: 'v2' } }],
            }),
          );
        },
      ],
      [
        'unreachable-value-is-warned-and-the-rest-is-covered',
        4,
        (ctx) => {
          const ids = names(ctx.rng, 4);
          const plan = planOk(
            ctx,
            makeStore({
              vars: ids.map((id) => ({ id, values: valueIds(3) })),
              rules: [{ id: 'rule.main', variables: ids }],
              forbids: [{ forbid: { [at(ids, 0)]: 'v2' } }],
            }),
          );
          must(
            codes(plan).includes('value_unreachable'),
            () => `a value no valid row can hold gave the warnings ${show(codes(plan))}`,
          );
        },
      ],
      [
        'pairwise-fine-tuple-that-no-row-holds',
        5,
        (ctx) => {
          planOk(ctx, chainedPairs(ctx));
        },
      ],
      [
        'unapproved-value-in-a-rule',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 4);
          planOk(
            ctx,
            makeStore({
              vars: ids.map((id, i) => ({
                id,
                values: i === 1 ? ['v0', 'v1', { id: 'v2', approved: false }] : valueIds(3),
              })),
              rules: [{ id: 'rule.main', variables: ids }],
            }),
          );
        },
      ],
      [
        'unapproved-variable-is-no-axis',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 4);
          planOk(
            ctx,
            makeStore({
              vars: ids.map((id, i) => ({
                id,
                values: valueIds(3),
                shared: true,
                ...(i === 2 ? { approved: false } : {}),
              })),
            }),
          );
        },
      ],
      [
        'unapproved-forbid-plans-nothing',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 4);
          planOk(
            ctx,
            makeStore({
              vars: ids.map((id) => ({ id, values: valueIds(3), shared: true })),
              forbids: [{ forbid: { [at(ids, 0)]: 'v0', [at(ids, 1)]: 'v0' }, approved: false }],
            }),
          );
        },
      ],
      [
        'two-rules-share-a-variable-beside-a-pair',
        4,
        (ctx) => {
          planOk(ctx, twoRulesWithPair(ctx));
        },
      ],
      [
        'a-pair-of-one-variable-beside-a-real-forbid',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 4);
          const store = makeStore({
            vars: ids.map((id) => ({ id, values: valueIds(3), shared: true })),
            impossible: [[at(ids, 0), 'v0', at(ids, 0), 'v1']],
            forbids: [{ forbid: { [at(ids, 1)]: 'v0', [at(ids, 2)]: 'v0', [at(ids, 3)]: 'v0' } }],
          });
          planOk(ctx, store);
        },
      ],
      [
        'rule-of-two-with-a-forbidden-cell',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 4);
          planOk(
            ctx,
            makeStore({
              vars: ids.map((id, i) => ({ id, values: valueIds(i < 2 ? 3 : 2) })),
              rules: [{ id: 'rule.pair', variables: ids.slice(0, 2) }],
              forbids: [{ forbid: { [at(ids, 0)]: 'v1', [at(ids, 1)]: 'v2' } }],
            }),
          );
        },
      ],
    ],
  },
  {
    id: 'diff.report',
    rules: ['R12'],
    family: 'counter',
    component: 'planner/counter',
    cause: 'the plan reports the exact allowed and held counts of a store where two rules of R6 to R8 meet',
    cases: [
      ['pairwise-fine-tuple-is-not-counted', 4, (ctx) => reportMatches(ctx, chainedPairs(ctx))],
      ['two-rules-with-a-pair', 4, (ctx) => reportMatches(ctx, twoRulesWithPair(ctx))],
      [
        'partial-seeds-and-an-unapproved-value',
        4,
        (ctx) => {
          const { store, ids } = axesWithUnapprovedValue(ctx);
          reportMatches(ctx, store, [
            { [at(ids, 0)]: 'v1', [at(ids, 2)]: 'v0' },
            { [at(ids, 1)]: 'v2', [at(ids, 3)]: 'v1' },
          ]);
        },
      ],
    ],
  },
  {
    id: 'diff.seeds',
    rules: ['R8'],
    family: 'seed-rows',
    component: 'planner/seeds',
    cause:
      'the plan keeps seeds as given and credits only the allowed tuples they hold, beside the rules of R6 and R7',
    cases: [
      [
        'partial-seeds-beside-a-forbid',
        4,
        (ctx) => {
          const ids = names(ctx.rng, 5);
          const store = makeStore({
            vars: ids.map((id, i) => ({ id, values: valueIds(i % 2 === 0 ? 3 : 2), shared: true })),
            forbids: [{ forbid: { [at(ids, 0)]: 'v0', [at(ids, 1)]: 'v0' } }],
          });
          const seeds: Row[] = [
            { [at(ids, 0)]: 'v1', [at(ids, 2)]: 'v0' },
            { [at(ids, 1)]: 'v1', [at(ids, 3)]: 'v1', [at(ids, 4)]: 'v0' },
            { [at(ids, 3)]: 'v0' },
          ];
          const plan = planOk(ctx, store, seeds);
          seeds.forEach((seed, i) => {
            must(
              sameRow(plan.rows[i]?.values ?? {}, seed),
              () => `seed ${i} became ${show(plan.rows[i]?.values)}; its assignments stay as given`,
            );
          });
        },
      ],
      [
        'seed-with-an-unapproved-value-is-kept-warned-and-credits-nothing',
        4,
        (ctx) => {
          const { store, ids } = axesWithUnapprovedValue(ctx);
          const seed: Row = { [at(ids, 0)]: 'v0', [at(ids, 1)]: 'v2', [at(ids, 2)]: 'v1' };
          const plan = planOk(ctx, store, [seed]);
          must(
            sameRow(plan.rows[0]?.values ?? {}, seed),
            () =>
              `the seed became ${show(plan.rows[0]?.values)}; a seed with an unapproved value is kept whole`,
          );
          must(
            codes(plan).includes('seed_unapproved_value'),
            () => `the warnings ${show(codes(plan))} lack seed_unapproved_value`,
          );
        },
      ],
      [
        'seeds-that-cover-everything-leave-no-new-rows',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 3);
          const store = makeStore({
            vars: ids.map((id, i) => ({ id, values: valueIds(i === 1 ? 2 : 3), shared: true })),
            forbids: [{ forbid: { [at(ids, 0)]: 'v1', [at(ids, 2)]: 'v2' } }],
          });
          const seeds = ctx.rng.shuffle(allRows(spaceOf(store)));
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          const fresh = newRows(plan).length;
          must(fresh === 0, () => `${fresh} new rows after seeds that hold every valid row`);
        },
      ],
    ],
  },
  {
    id: 'diff.order',
    rules: ['R9'],
    family: 'budget-order',
    component: 'planner/budget',
    cause:
      'the plan orders and cuts rows by the product of shares when weights meet constraints, seeds and budgets',
    cases: [
      [
        'zero-weight-rows-come-last',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 4);
          const store = weighted(ids, [...drawWeights(ctx, 3, true), undefined]);
          checkOrder(store, planOk(ctx, store));
        },
      ],
      [
        'budget-keeps-a-prefix-beside-seeds-and-a-forbid',
        4,
        (ctx) => {
          const ids = names(ctx.rng, 4);
          const store = weighted(ids, [...drawWeights(ctx, 3), undefined], {
            forbids: [{ forbid: { [at(ids, 0)]: 'v0', [at(ids, 1)]: 'v1' } }],
          });
          const seeds: Row[] = [{ [at(ids, 0)]: 'v1' }, { [at(ids, 1)]: 'v0', [at(ids, 2)]: 'v2' }];
          const full = callPlan(ctx, store, { seed: ctx.seed, seeds });
          must(full.rows.length > seeds.length + 3, () => `the uncut plan has only ${full.rows.length} rows`);
          const budget = ctx.rng.int(seeds.length + 1, full.rows.length - 1);
          const cut = callPlan(ctx, store, { seed: ctx.seed, seeds, budget });
          must(
            jsonEqual(cut.rows, full.rows.slice(0, budget)),
            () => `a budget of ${budget} did not keep the first ${budget} rows of the uncut plan`,
          );
        },
      ],
      [
        'scaling-the-weights-of-a-variable-changes-nothing',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 4);
          const w = drawWeights(ctx, 3);
          const plain = callPlan(ctx, weighted(ids, [...w, undefined]), { seed: ctx.seed });
          const scaled = callPlan(
            ctx,
            weighted(ids, [(w[0] as number[]).map((x) => x * 7), w[1], w[2], undefined]),
            { seed: ctx.seed },
          );
          must(
            jsonEqual(plain.rows, scaled.rows),
            () => 'multiplying every weight of one variable changed the plan',
          );
        },
      ],
      [
        'unweighted-variables-beside-a-weighted-one-share-uniformly',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 4);
          const store = weighted(ids, [drawWeights(ctx, 1)[0], undefined, undefined, undefined]);
          checkOrder(store, planOk(ctx, store));
        },
      ],
    ],
  },
];
