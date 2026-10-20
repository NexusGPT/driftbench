import type { ItemContext } from '../../bank/item';
import type { Plan, Row, StoreDoc } from '../../interface';
import {
  allowedTuples,
  allRows,
  assertCovered,
  assertRowsSound,
  callPlan,
  coveredTuples,
  makeStore,
  must,
  names,
  newRows,
  requiredGroups,
  rowCap,
  type Space,
  type Stem,
  spaceOf,
  valueIds,
  widestTuple,
} from '../kit';

/** Family strength: R6 (3 inside rules, 2 across approved axes, 1 elsewhere), R7, R11, R12 (report), R14 (row cap). */

type RuleStore = { store: StoreDoc; ids: string[] };

/** A store whose variables are details (no pair crossing) and one rule over the first `inRule` of them. */
function ruleStore(
  ctx: ItemContext,
  arities: number[],
  inRule: number,
  extra: { shared?: boolean } = {},
): RuleStore {
  const ids = names(ctx.rng, arities.length) as string[];
  const store = makeStore({
    vars: arities.map((a, i) => ({
      id: ids[i] as string,
      values: valueIds(a),
      shared: extra.shared ?? false,
    })),
    rules: [{ id: 'rule.main', variables: ids.slice(0, inRule) }],
  });
  return { store, ids };
}

function planChecked(ctx: ItemContext, store: StoreDoc, seeds: Row[] = []): { plan: Plan; space: Space } {
  const space = spaceOf(store);
  const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
  assertRowsSound(space, plan, seeds);
  assertCovered(space, plan, seeds);
  return { plan, space };
}

function fullProduct(arities: number[]): number {
  return arities.reduce((p, a) => p * a, 1);
}

function under60(ctx: ItemContext, arities: number[]): void {
  const { store } = ruleStore(ctx, arities, arities.length);
  const { plan } = planChecked(ctx, store);
  const fresh = newRows(plan).length;
  const limit = Math.ceil(0.6 * fullProduct(arities)) - 1;
  must(
    fresh <= limit,
    () =>
      `${fresh} new rows for one rule of ${arities.length} variables; the page asks for fewer than 60 percent of the full product (${limit} at most)`,
  );
}

function capHolds(ctx: ItemContext, store: StoreDoc, seeds: Row[], factor = 1.25): void {
  const space = spaceOf(store);
  const groups = requiredGroups(space);
  const allowed = allowedTuples(space, groups, allRows(space));
  const { missing } = coveredTuples(groups, allowed, seeds, space);
  const cap = rowCap(missing.length, widestTuple(space), factor);
  const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
  assertRowsSound(space, plan, seeds);
  assertCovered(space, plan, seeds);
  const fresh = newRows(plan).length;
  must(
    fresh <= cap,
    () =>
      `${fresh} new rows; the page allows ${cap} (ceil(${factor} G) + 1 with ${missing.length} tuples missing and a widest tuple of ${widestTuple(space)} cells)`,
  );
}

function reportCounts(ctx: ItemContext, store: StoreDoc, seeds: Row[] = []): void {
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

export const STRENGTH_STEMS: readonly Stem[] = [
  {
    id: 'strength.rule-triples',
    rules: ['R6', 'R14'],
    family: 'strength',
    component: 'planner/strength',
    cause:
      'every rule is crossed at strength min(3, its size): all combinations of every three of its variables',
    cases: [
      ['rule-of-one', 1, (ctx) => void planChecked(ctx, ruleStore(ctx, [4], 1).store)],
      ['rule-of-two', 1, (ctx) => void planChecked(ctx, ruleStore(ctx, [3, 3], 2).store)],
      ['rule-of-three', 2, (ctx) => void planChecked(ctx, ruleStore(ctx, [3, 2, 3], 3).store)],
      ['rule-of-four', 2, (ctx) => void planChecked(ctx, ruleStore(ctx, [2, 3, 2, 3], 4).store)],
      ['rule-of-five', 3, (ctx) => void planChecked(ctx, ruleStore(ctx, [2, 2, 3, 2, 2], 5).store)],
      ['rule-of-six-binary-under-60-percent', 3, (ctx) => under60(ctx, [2, 2, 2, 2, 2, 2])],
      ['rule-of-eight-binary-under-60-percent', 4, (ctx) => under60(ctx, [2, 2, 2, 2, 2, 2, 2, 2])],
      ['rule-of-five-ternary-under-60-percent', 4, (ctx) => under60(ctx, [3, 3, 3, 3, 3])],
      ['rule-of-four-quaternary-under-60-percent', 4, (ctx) => under60(ctx, [4, 4, 4, 4])],
      [
        'rule-covers-its-triples-not-its-quadruples',
        5,
        (ctx) => {
          // 5 binary variables in one rule: every triple (80 tuples) is required, every quadruple is not.
          const { store } = ruleStore(ctx, [2, 2, 2, 2, 2], 5);
          const { plan } = planChecked(ctx, store);
          const fresh = newRows(plan).length;
          must(
            fresh < 32,
            () => `${fresh} new rows: the whole product of 5 binary variables (32) is not required`,
          );
        },
      ],
    ],
  },
  {
    id: 'strength.shared-pairs',
    rules: ['R6'],
    family: 'strength',
    component: 'planner/strength',
    cause:
      'every pair of approved shared axes is crossed at strength 2 whether or not a rule joins them, and details never make a pair',
    cases: [
      [
        'two-binary-axes',
        1,
        (ctx) =>
          void planChecked(
            ctx,
            makeStore({ vars: names(ctx.rng, 2).map((id) => ({ id, values: valueIds(2), shared: true })) }),
          ),
      ],
      [
        'five-binary-axes',
        2,
        (ctx) =>
          void planChecked(
            ctx,
            makeStore({ vars: names(ctx.rng, 5).map((id) => ({ id, values: valueIds(2), shared: true })) }),
          ),
      ],
      [
        'four-ternary-axes',
        2,
        (ctx) =>
          void planChecked(
            ctx,
            makeStore({ vars: names(ctx.rng, 4).map((id) => ({ id, values: valueIds(3), shared: true })) }),
          ),
      ],
      [
        'mixed-arity-axes',
        3,
        (ctx) => {
          const arities = [2, 5, 3, 4];
          void planChecked(
            ctx,
            makeStore({
              vars: names(ctx.rng, 4).map((id, i) => ({
                id,
                values: valueIds(arities[i] as number),
                shared: true,
              })),
            }),
          );
        },
      ],
      [
        'axes-no-rule-joins',
        3,
        (ctx) => {
          // Two rules over disjoint variables; the axes are still crossed pair by pair across the rules.
          const ids = names(ctx.rng, 6) as string[];
          const store = makeStore({
            vars: ids.map((id, i) => ({ id, values: valueIds(2), shared: i === 0 || i === 3 })),
            rules: [
              { id: 'rule.a', variables: ids.slice(0, 3) },
              { id: 'rule.b', variables: ids.slice(3, 6) },
            ],
          });
          const { plan } = planChecked(ctx, store);
          const a = ids[0] as string;
          const b = ids[3] as string;
          for (const x of ['v0', 'v1']) {
            for (const y of ['v0', 'v1']) {
              must(
                plan.rows.some((r) => r.values[a] === x && r.values[b] === y),
                () => `no row holds ${a}=${x} with ${b}=${y}, a pair of two axes`,
              );
            }
          }
        },
      ],
      [
        'details-are-not-crossed',
        4,
        (ctx) => {
          // Eight ternary details no rule names need at most twice the arity in rows; crossing them in pairs would need more.
          const store = makeStore({
            vars: names(ctx.rng, 8).map((id) => ({ id, values: valueIds(3), shared: false })),
          });
          const { plan } = planChecked(ctx, store);
          const fresh = newRows(plan).length;
          must(
            fresh <= 6,
            () => `${fresh} new rows for eight independent ternary details; six are enough (twice the arity)`,
          );
        },
      ],
      [
        'one-axis-alone-is-covered-by-value',
        2,
        (ctx) => {
          const ids = names(ctx.rng, 3) as string[];
          const store = makeStore({
            vars: [
              { id: ids[0] as string, values: valueIds(4), shared: true },
              { id: ids[1] as string, values: valueIds(2), shared: false },
              { id: ids[2] as string, values: valueIds(2), shared: false },
            ],
          });
          const { plan } = planChecked(ctx, store);
          for (const x of valueIds(4))
            must(
              plan.rows.some((r) => r.values[ids[0] as string] === x),
              () => `the value ${x} of the lone axis is in no row`,
            );
        },
      ],
    ],
  },
  {
    id: 'strength.singles',
    rules: ['R6'],
    family: 'strength',
    component: 'planner/strength',
    cause: 'a variable that no rule and no axis pair names is covered at strength 1: every value once',
    cases: [
      [
        'one-detail',
        1,
        (ctx) =>
          void planChecked(
            ctx,
            makeStore({ vars: [{ id: names(ctx.rng, 1)[0] as string, values: valueIds(5) }] }),
          ),
      ],
      [
        'independent-details',
        2,
        (ctx) =>
          void planChecked(
            ctx,
            makeStore({ vars: names(ctx.rng, 6).map((id, i) => ({ id, values: valueIds(2 + (i % 3)) })) }),
          ),
      ],
      [
        'details-share-rows',
        3,
        (ctx) => {
          // Seven details of arity 4: four rows can carry every value of every detail.
          const store = makeStore({ vars: names(ctx.rng, 7).map((id) => ({ id, values: valueIds(4) })) });
          const { plan } = planChecked(ctx, store);
          const fresh = newRows(plan).length;
          must(
            fresh <= 8,
            () => `${fresh} new rows for seven independent details of arity 4; twice the arity bounds it`,
          );
        },
      ],
      [
        'detail-outside-the-rule',
        3,
        (ctx) => {
          const { store, ids } = ruleStore(ctx, [2, 2, 2, 3], 3);
          const { plan } = planChecked(ctx, store);
          for (const x of valueIds(3))
            must(
              plan.rows.some((r) => r.values[ids[3] as string] === x),
              () => `the value ${x} of the detail outside the rule is in no row`,
            );
        },
      ],
    ],
  },
  {
    id: 'strength.group-size',
    rules: ['R6'],
    family: 'strength',
    component: 'planner/strength',
    cause:
      'strength is capped at the size of the group and rules are read as sets of known approved variables',
    cases: [
      [
        'repeated-variable-in-a-rule',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 3) as string[];
          const store = makeStore({
            vars: ids.map((id) => ({ id, values: valueIds(2) })),
            rules: [
              {
                id: 'rule.rep',
                variables: [ids[0] as string, ids[0] as string, ids[1] as string, ids[2] as string],
              },
            ],
          });
          planChecked(ctx, store);
        },
      ],
      [
        'rule-names-an-unknown-variable',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 3) as string[];
          const store = makeStore({
            vars: ids.slice(0, 2).map((id) => ({ id, values: valueIds(3) })),
            rules: [{ id: 'rule.ghost', variables: [ids[0] as string, ids[1] as string, ids[2] as string] }],
          });
          planChecked(ctx, store);
        },
      ],
      [
        'rule-names-an-unapproved-variable',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 3) as string[];
          const store = makeStore({
            vars: [
              { id: ids[0] as string, values: valueIds(2) },
              { id: ids[1] as string, values: valueIds(2) },
              { id: ids[2] as string, values: valueIds(2), approved: false },
            ],
            rules: [{ id: 'rule.mixed', variables: ids }],
          });
          const { plan } = planChecked(ctx, store);
          for (const r of newRows(plan))
            must(!((ids[2] as string) in r.values), () => `row ${r.id} assigns the unapproved variable`);
        },
      ],
      [
        'rule-with-no-variables',
        2,
        (ctx) => {
          const ids = names(ctx.rng, 2) as string[];
          const store = makeStore({
            vars: ids.map((id) => ({ id, values: valueIds(3) })),
            rules: [{ id: 'rule.empty', variables: [] }],
          });
          planChecked(ctx, store);
        },
      ],
      [
        'rule-of-seven-needs-triples-only',
        5,
        (ctx) => {
          const { store } = ruleStore(ctx, [2, 2, 2, 2, 2, 2, 2], 7);
          const { plan } = planChecked(ctx, store);
          const fresh = newRows(plan).length;
          must(
            fresh < 128 * 0.6,
            () =>
              `${fresh} new rows for a rule of seven binary variables; strength 3 needs far fewer than the 128 of the whole product`,
          );
        },
      ],
    ],
  },
  {
    id: 'strength.row-cap',
    rules: ['R14'],
    family: 'strength',
    component: 'planner/strength',
    cause: 'the plan stays under the greedy row cap of the page: ceil(1.25 G) + 1 new rows',
    cases: [
      [
        'eight-binary-axes',
        3,
        (ctx) =>
          capHolds(
            ctx,
            makeStore({ vars: names(ctx.rng, 8).map((id) => ({ id, values: valueIds(2), shared: true })) }),
            [],
          ),
      ],
      [
        'six-ternary-axes',
        3,
        (ctx) =>
          capHolds(
            ctx,
            makeStore({ vars: names(ctx.rng, 6).map((id) => ({ id, values: valueIds(3), shared: true })) }),
            [],
          ),
      ],
      [
        'binary-rule-of-six-beside-axes',
        4,
        (ctx) => {
          const ids = names(ctx.rng, 8) as string[];
          const store = makeStore({
            vars: ids.map((id, i) => ({ id, values: valueIds(2), shared: i >= 6 })),
            rules: [{ id: 'rule.six', variables: ids.slice(0, 6) }],
          });
          capHolds(ctx, store, []);
        },
      ],
      [
        'after-seeds',
        4,
        (ctx) => {
          const ids = names(ctx.rng, 7) as string[];
          const store = makeStore({ vars: ids.map((id) => ({ id, values: valueIds(2), shared: true })) });
          const seeds: Row[] = Array.from({ length: 6 }, () =>
            Object.fromEntries(ids.map((id) => [id, ctx.rng.pick(['v0', 'v1'])])),
          );
          capHolds(ctx, store, seeds);
        },
      ],
      [
        'one-wide-axis-and-three-binary',
        5,
        (ctx) => {
          const ids = names(ctx.rng, 4) as string[];
          const store = makeStore({
            vars: [
              { id: ids[0] as string, values: valueIds(20), shared: true },
              ...ids.slice(1).map((id) => ({ id, values: valueIds(2), shared: true })),
            ],
          });
          capHolds(ctx, store, []);
        },
      ],
    ],
  },
  {
    id: 'strength.report',
    rules: ['R12', 'R6'],
    family: 'strength',
    component: 'planner/strength',
    cause: 'the plan reports the exact number of allowed required tuples and the number its kept rows hold',
    cases: [
      [
        'axes-only',
        2,
        (ctx) =>
          reportCounts(
            ctx,
            makeStore({ vars: names(ctx.rng, 4).map((id) => ({ id, values: valueIds(3), shared: true })) }),
          ),
      ],
      ['one-rule', 2, (ctx) => reportCounts(ctx, ruleStore(ctx, [2, 3, 2, 2], 4).store)],
      [
        'rule-overlapping-axes',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 5) as string[];
          reportCounts(
            ctx,
            makeStore({
              vars: ids.map((id, i) => ({ id, values: valueIds(2 + (i % 2)), shared: i < 3 })),
              rules: [{ id: 'rule.over', variables: ids.slice(0, 4) }],
            }),
          );
        },
      ],
      [
        'two-overlapping-rules',
        4,
        (ctx) => {
          const ids = names(ctx.rng, 6) as string[];
          reportCounts(
            ctx,
            makeStore({
              vars: ids.map((id) => ({ id, values: valueIds(2) })),
              rules: [
                { id: 'rule.p', variables: ids.slice(0, 4) },
                { id: 'rule.q', variables: ids.slice(2, 6) },
              ],
            }),
          );
        },
      ],
      [
        'with-constraints',
        4,
        (ctx) => {
          const ids = names(ctx.rng, 4) as string[];
          reportCounts(
            ctx,
            makeStore({
              vars: ids.map((id) => ({ id, values: valueIds(3), shared: true })),
              impossible: [
                [ids[0] as string, 'v0', ids[1] as string, 'v0'],
                [ids[1] as string, 'v1', ids[2] as string, 'v2'],
                [ids[0] as string, 'v2', ids[3] as string, 'v1'],
              ],
            }),
          );
        },
      ],
      [
        'with-seeds-partly-covering',
        4,
        (ctx) => {
          const ids = names(ctx.rng, 4) as string[];
          const store = makeStore({ vars: ids.map((id) => ({ id, values: valueIds(2), shared: true })) });
          reportCounts(ctx, store, [
            { [ids[0] as string]: 'v0', [ids[1] as string]: 'v1' },
            { [ids[2] as string]: 'v0', [ids[3] as string]: 'v0', [ids[0] as string]: 'v1' },
          ]);
        },
      ],
      [
        'unapproved-value-is-outside-the-counts',
        4,
        (ctx) => {
          const ids = names(ctx.rng, 3) as string[];
          reportCounts(
            ctx,
            makeStore({
              vars: [
                {
                  id: ids[0] as string,
                  values: ['v0', 'v1', { id: 'proposed', approved: false }],
                  shared: true,
                },
                { id: ids[1] as string, values: valueIds(2), shared: true },
                { id: ids[2] as string, values: valueIds(2), shared: true },
              ],
            }),
          );
        },
      ],
    ],
  },
];
