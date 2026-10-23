import { check } from '../../../../failure';
import type { ItemContext } from '../../bank/item';
import { clone, deepFreeze } from '../../bank/util';
import type { Plan, Row, StoreDoc } from '../../interface';
import { allowedTuples, allRows, assertCovered, assertRowsSound, callPlan, coveredTuples, jsonEqual, makeStore, names, newRows, requiredGroups, type Stem, sameRow, show, spaceOf, valueIds } from '../kit';

/** Family seed-rows: R7, R8 (seed retention, credit, warnings), R11 (ownership, determinism), R15 capacity lives in scale. */

function axes(ctx: ItemContext, count: number, arity: number): { store: StoreDoc; ids: string[] } {
  const ids = names(ctx.rng, count) as string[];
  return {
    store: makeStore({ vars: ids.map((id) => ({ id, values: valueIds(arity), shared: true })) }),
    ids,
  };
}

function warn(plan: Plan): string[] {
  return (plan.warnings ?? []).map((w) => w.code);
}

function randomSeeds(ctx: ItemContext, store: StoreDoc, count: number): Row[] {
  return Array.from({ length: count }, () =>
    Object.fromEntries(store.variables.map((v) => [v.id, ctx.rng.pick(v.values).id])),
  );
}

/** Every full row of a small space, in a seeded order. */
function fullRows(ctx: ItemContext, store: StoreDoc): Row[] {
  return ctx.rng.shuffle(allRows(spaceOf(store)));
}

function creditReduces(ctx: ItemContext, fraction: number | 'all-but-one'): void {
  const { store } = axes(ctx, 7, 3);
  const space = spaceOf(store);
  const bare = callPlan(ctx, store, { seed: ctx.seed });
  const n0 = newRows(bare).length;
  check(n0 >= 4, () => ({ rule: 'the unseeded plan has only {} rows; the item needs more to compare', got: { details: [n0] } }));
  const take = fraction === 'all-but-one' ? n0 - 1 : Math.max(1, Math.floor(n0 * fraction));
  const seeds = newRows(bare)
    .slice(0, take)
    .map((r) => ({ ...r.values }));
  const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
  assertRowsSound(space, plan, seeds);
  assertCovered(space, plan, seeds);
  const n1 = newRows(plan).length;
  check(n1 < n0, () => ({ rule: '{} new rows with {} seeds against {} without: seed credit did not reduce the new rows', got: { details: [n1, take, n0] } }));
}

export const SEEDS_STEMS: readonly Stem[] = [
  {
    id: 'seeds.leading',
    rules: ['R8', 'R11'],
    family: 'seed-rows',
    component: 'planner/seeds',
    cause: 'seed rows lead the plan in input order with their assignments unchanged, as kind seed',
    cases: [
      [
        'seeds-first-in-order',
        1,
        (ctx) => {
          const { store } = axes(ctx, 4, 3);
          const seeds = randomSeeds(ctx, store, 3);
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          for (let i = 0; i < 3; i += 1) {
            const r = plan.rows[i];
            check(r?.kind === 'seed' &&
                jsonEqual(Object.entries(r.values).sort(), Object.entries(seeds[i] as Row).sort()), () => ({ rule: 'a seed row keeps the seed as given', input: { row: i }, got: { row: show(r, 140) } }));
          }
          for (const r of plan.rows.slice(3))
            check(r.kind === 'new', () => ({ rule: 'row {} after the seeds has kind {}', got: { details: [r.id, r.kind] } }));
        },
      ],
      [
        'partial-seed-is-not-completed',
        2,
        (ctx) => {
          const { store, ids } = axes(ctx, 4, 2);
          const seeds: Row[] = [
            { [ids[0] as string]: 'v1' },
            { [ids[1] as string]: 'v0', [ids[2] as string]: 'v1' },
          ];
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          check(sameRow(plan.rows[0]?.values ?? {}, seeds[0] as Row), () => ({ rule: 'seed 0 became {}; its assignments stay as given', got: { details: [show(plan.rows[0]?.values)] } }));
          check(sameRow(plan.rows[1]?.values ?? {}, seeds[1] as Row), () => ({ rule: 'seed 1 became {}', got: { details: [show(plan.rows[1]?.values)] } }));
        },
      ],
      [
        'seed-rows-are-copies',
        3,
        (ctx) => {
          const { store, ids } = axes(ctx, 3, 2);
          const seeds: Row[] = [
            { [ids[0] as string]: 'v0', [ids[1] as string]: 'v0', [ids[2] as string]: 'v0' },
          ];
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          (plan.rows[0] as Plan['rows'][number]).values[ids[0] as string] = 'changed after planning';
          check(seeds[0]?.[ids[0] as string] === 'v0', () => ({ rule: 'changing a plan row changed the seed the caller passed in' }));
          const before = JSON.stringify(plan.rows.slice(1));
          (seeds[0] as Row)[ids[1] as string] = 'changed by the caller';
          check(JSON.stringify(plan.rows.slice(1)) === before, () => ({ rule: 'changing the caller seed changed the plan' }));
          check(plan.rows[0]?.values[ids[1] as string] === 'v0', () => ({ rule: 'changing the caller seed changed the seed row in the plan' }));
        },
      ],
      [
        'frozen-inputs-are-accepted',
        3,
        (ctx) => {
          const { store } = axes(ctx, 4, 3);
          const seeds = randomSeeds(ctx, store, 2);
          const frozenStore = deepFreeze(clone(store));
          const frozenSeeds = deepFreeze(clone(seeds));
          const plan = callPlan(ctx, frozenStore, { seed: ctx.seed, seeds: frozenSeeds });
          assertRowsSound(spaceOf(store), plan, seeds);
        },
      ],
      [
        'rows-have-distinct-nonempty-ids',
        1,
        (ctx) => {
          const { store } = axes(ctx, 4, 2);
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds: randomSeeds(ctx, store, 2) });
          const ids = plan.rows.map((r) => r.id);
          check(ids.every((id) => typeof id === 'string' && id.length > 0), () => ({ rule: 'empty or non-string id in {}', got: { details: [show(ids)] } }));
          check(new Set(ids).size === ids.length, () => ({ rule: 'repeated ids in {}', got: { details: [show(ids)] } }));
        },
      ],
      [
        'absent-and-empty-seeds-are-equal',
        2,
        (ctx) => {
          const { store } = axes(ctx, 4, 3);
          const a = callPlan(ctx, store, { seed: ctx.seed });
          const b = callPlan(ctx, store, { seed: ctx.seed, seeds: [] });
          check(jsonEqual(a, b), () => ({ rule: 'a plan with seeds: [] differs from a plan with no seeds' }));
        },
      ],
      [
        'the-same-seed-twice-is-kept-twice',
        3,
        (ctx) => {
          const { store } = axes(ctx, 3, 2);
          const one = randomSeeds(ctx, store, 1)[0] as Row;
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds: [{ ...one }, { ...one }] });
          check(plan.rows[0]?.kind === 'seed' && plan.rows[1]?.kind === 'seed', () => ({ rule: 'two equal seeds are not both kept as seeds' }));
          check(plan.rows[0]?.id !== plan.rows[1]?.id, () => ({ rule: 'two equal seeds share an id' }));
        },
      ],
      [
        'new-rows-repeat-no-seed',
        3,
        (ctx) => {
          const { store } = axes(ctx, 4, 2);
          const space = spaceOf(store);
          const seeds = fullRows(ctx, store).slice(0, 5);
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          assertRowsSound(space, plan, seeds);
        },
      ],
    ],
  },
  {
    id: 'seeds.credit',
    rules: ['R8'],
    family: 'seed-rows',
    component: 'planner/seeds',
    cause:
      'seeds credit every allowed required tuple whose variables they assign, and new rows cover only what the seeds miss',
    cases: [
      [
        'seeds-that-cover-everything-leave-no-new-row',
        2,
        (ctx) => {
          const { ids } = axes(ctx, 3, 2);
          const store = makeStore({ vars: ids.map((id) => ({ id, values: valueIds(2), shared: true })) });
          // 000, 011, 101, 110 hold every pair of three binary axes.
          const seeds: Row[] = [
            [0, 0, 0],
            [0, 1, 1],
            [1, 0, 1],
            [1, 1, 0],
          ].map((bits) => Object.fromEntries(ids.map((id, i) => [id, `v${bits[i]}`])));
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          check(newRows(plan).length === 0, () => ({ rule: '{} new rows although the seeds hold every pair', got: { details: [newRows(plan).length] } }));
        },
      ],
      [
        'every-full-row-as-a-seed',
        2,
        (ctx) => {
          const { store } = axes(ctx, 3, 3);
          const seeds = fullRows(ctx, store);
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          check(newRows(plan).length === 0, () => ({ rule: '{} new rows although every possible row is a seed', got: { details: [newRows(plan).length] } }));
        },
      ],
      [
        'partial-seeds-credit-the-tuples-they-assign',
        3,
        (ctx) => {
          const { store, ids } = axes(ctx, 3, 2);
          // Six pair-seeds hold all twelve pairs of three binary axes; none assigns the third variable.
          const seeds: Row[] = [];
          for (const [p, q] of [
            [0, 1],
            [1, 2],
            [0, 2],
          ] as const) {
            for (const x of ['v0', 'v1'])
              for (const y of ['v0', 'v1']) seeds.push({ [ids[p] as string]: x, [ids[q] as string]: y });
          }
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          check(newRows(plan).length === 0, () => ({ rule: '{} new rows although the partial seeds hold every pair', got: { details: [newRows(plan).length] } }));
          check(plan.rows.length === seeds.length, () => ({ rule: '{} rows for {} seeds', got: { details: [plan.rows.length, seeds.length] } }));
        },
      ],
      [
        'partial-seed-does-not-credit-what-it-does-not-assign',
        4,
        (ctx) => {
          const { store, ids } = axes(ctx, 3, 2);
          // One seed assigns only the first variable: it credits no pair, so the plan must still hold all twelve.
          const seeds: Row[] = [{ [ids[0] as string]: 'v0' }];
          const space = spaceOf(store);
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          assertRowsSound(space, plan, seeds);
          assertCovered(space, plan, seeds);
          check(newRows(plan).length >= 4, () => ({ rule: '{} new rows; four are the least that hold the pairs a one-entry seed leaves open', got: { details: [newRows(plan).length] } }));
        },
      ],
      [
        'each-new-row-covers-a-tuple-the-seeds-miss',
        4,
        (ctx) => {
          const { store } = axes(ctx, 5, 3);
          const space = spaceOf(store);
          const seeds = randomSeeds(ctx, store, 6);
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          assertRowsSound(space, plan, seeds);
          const groups = requiredGroups(space);
          const allowed = allowedTuples(space, groups, allRows(space));
          const bySeeds = coveredTuples(groups, allowed, seeds, space).covered;
          for (const r of newRows(plan)) {
            const own = coveredTuples(groups, allowed, [r.values], space).covered;
            check([...own].some((k) => !bySeeds.has(k)), () => ({ rule: 'the new row {} covers nothing the seeds do not already hold', got: { details: [r.id] } }));
          }
        },
      ],
      ['thirty-percent-covered', 3, (ctx) => creditReduces(ctx, 0.3)],
      ['half-covered', 3, (ctx) => creditReduces(ctx, 0.5)],
      ['ninety-percent-covered', 4, (ctx) => creditReduces(ctx, 0.9)],
      ['mostly-covered', 4, (ctx) => creditReduces(ctx, 'all-but-one')],
      [
        'seeds-and-new-rows-cover-all-required-tuples',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 5) as string[];
          const store = makeStore({
            vars: ids.map((id, i) => ({ id, values: valueIds(2 + (i % 2)), shared: i < 3 })),
            rules: [{ id: 'rule.r', variables: ids.slice(2, 5) }],
            impossible: [[ids[0] as string, 'v0', ids[1] as string, 'v1']],
          });
          const seeds: Row[] = [
            { [ids[0] as string]: 'v1', [ids[1] as string]: 'v0', [ids[2] as string]: 'v2' },
          ];
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          assertRowsSound(spaceOf(store), plan, seeds);
          assertCovered(spaceOf(store), plan, seeds);
        },
      ],
    ],
  },
  {
    id: 'seeds.warnings',
    rules: ['R8'],
    family: 'seed-rows',
    component: 'planner/seeds',
    cause: 'irregular seeds are kept as the page says and the plan warns with the code of the page',
    cases: [
      [
        'unknown-variable-is-dropped-from-the-seed',
        2,
        (ctx) => {
          const { store, ids } = axes(ctx, 3, 2);
          const seeds: Row[] = [{ [ids[0] as string]: 'v0', ghost_variable: 'v1' }];
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          check(sameRow(plan.rows[0]?.values ?? {}, { [ids[0] as string]: 'v0' }), () => ({ rule: 'the seed row is {}; the unknown variable goes, the rest stays', got: { details: [show(plan.rows[0]?.values)] } }));
          check(warn(plan).includes('seed_unknown_value'), () => ({ rule: 'warnings {} lack seed_unknown_value', got: { details: [show(plan.warnings)] } }));
        },
      ],
      [
        'unknown-value-is-dropped-from-the-seed',
        2,
        (ctx) => {
          const { store, ids } = axes(ctx, 3, 2);
          const seeds: Row[] = [{ [ids[0] as string]: 'not_a_value', [ids[1] as string]: 'v1' }];
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          check(sameRow(plan.rows[0]?.values ?? {}, { [ids[1] as string]: 'v1' }), () => ({ rule: 'the seed row is {}', got: { details: [show(plan.rows[0]?.values)] } }));
          check(warn(plan).includes('seed_unknown_value'), () => ({ rule: 'warnings {} lack seed_unknown_value', got: { details: [show(plan.warnings)] } }));
        },
      ],
      [
        'unapproved-value-is-kept-whole',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 2) as string[];
          const store = makeStore({
            vars: [
              {
                id: ids[0] as string,
                values: ['v0', 'v1', { id: 'proposed', approved: false }],
                shared: true,
              },
              { id: ids[1] as string, values: valueIds(2), shared: true },
            ],
          });
          const seeds: Row[] = [{ [ids[0] as string]: 'proposed', [ids[1] as string]: 'v0' }];
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          check(sameRow(plan.rows[0]?.values ?? {}, seeds[0] as Row), () => ({ rule: 'the seed row is {}; it is kept whole, unapproved entry included', got: { details: [show(plan.rows[0]?.values)] } }));
          check(warn(plan).includes('seed_unapproved_value'), () => ({ rule: 'warnings {} lack seed_unapproved_value', got: { details: [show(plan.warnings)] } }));
        },
      ],
      [
        'forbidden-seed-is-kept',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 2) as string[];
          const store = makeStore({
            vars: ids.map((id) => ({ id, values: valueIds(2), shared: true })),
            impossible: [[ids[0] as string, 'v0', ids[1] as string, 'v0']],
          });
          const seeds: Row[] = [{ [ids[0] as string]: 'v0', [ids[1] as string]: 'v0' }];
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          check(sameRow(plan.rows[0]?.values ?? {}, seeds[0] as Row) && plan.rows[0]?.kind === 'seed', () => ({ rule: 'the forbidden seed became {}', got: { details: [show(plan.rows[0])] } }));
          check(warn(plan).includes('seed_forbidden'), () => ({ rule: 'warnings {} lack seed_forbidden', got: { details: [show(plan.warnings)] } }));
          for (const r of newRows(plan))
            check(!(r.values[ids[0] as string] === 'v0' && r.values[ids[1] as string] === 'v0'), () => ({ rule: 'new row {} holds the forbidden pair', got: { details: [r.id] } }));
        },
      ],
      [
        'nothing-approved-the-plan-is-the-seeds',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 2) as string[];
          const store = makeStore({
            vars: ids.map((id) => ({ id, values: valueIds(2), shared: true, approved: false })),
          });
          const seeds: Row[] = [{ [ids[0] as string]: 'v0' }, { [ids[1] as string]: 'v1' }];
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
          check(plan.rows.length === 2 && plan.rows.every((r) => r.kind === 'seed'), () => ({ rule: 'rows {}; expected the two seeds alone', got: { details: [show(plan.rows, 200)] } }));
          check(warn(plan).includes('no_variables'), () => ({ rule: 'warnings {} lack no_variables', got: { details: [show(plan.warnings)] } }));
        },
      ],
      [
        'nothing-approved-and-no-seeds',
        3,
        (ctx) => {
          const ids = names(ctx.rng, 2) as string[];
          const store = makeStore({ vars: ids.map((id) => ({ id, values: valueIds(3), approved: false })) });
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          check(plan.rows.length === 0, () => ({ rule: '{} rows from a store where nothing is approved', got: { details: [plan.rows.length] } }));
          check(warn(plan).includes('no_variables'), () => ({ rule: 'warnings {} lack no_variables', got: { details: [show(plan.warnings)] } }));
        },
      ],
      [
        'a-warning-is-a-code-and-a-message',
        2,
        (ctx) => {
          const { store, ids } = axes(ctx, 2, 2);
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds: [{ [ids[0] as string]: 'zzz' }] });
          check((plan.warnings ?? []).length >= 1, () => ({ rule: 'no warning for a seed with an unknown value' }));
          for (const w of plan.warnings ?? []) {
            check(typeof w.code === 'string' &&
                w.code.length > 0 &&
                typeof w.message === 'string' &&
                w.message.length > 0, () => ({ rule: 'warning {} is not {code, message}', got: { details: [show(w)] } }));
          }
        },
      ],
      [
        'regular-seeds-raise-no-warning',
        2,
        (ctx) => {
          const { store } = axes(ctx, 3, 3);
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds: randomSeeds(ctx, store, 3) });
          check((plan.warnings ?? []).length === 0, () => ({ rule: 'warnings {} for regular seeds', got: { details: [show(plan.warnings)] } }));
        },
      ],
    ],
  },
  {
    id: 'seeds.determinism',
    rules: ['R11'],
    family: 'seed-rows',
    component: 'planner/determinism',
    cause:
      'equal inputs, options and seed give equal bytes, for every safe integer seed, and the inputs are not changed',
    cases: [
      [
        'same-options-same-bytes',
        2,
        (ctx) => {
          const { store } = axes(ctx, 5, 3);
          const seeds = randomSeeds(ctx, store, 3);
          const a = callPlan(ctx, store, { seed: ctx.seed, seeds, budget: 12 });
          const b = callPlan(ctx, clone(store), { seed: ctx.seed, seeds: clone(seeds), budget: 12 });
          check(JSON.stringify(a) === JSON.stringify(b), () => ({ rule: 'the same store, seeds and options gave different bytes' }));
        },
      ],
      [
        'zero-seed',
        3,
        (ctx) => {
          const { store } = axes(ctx, 4, 3);
          const a = callPlan(ctx, store, { seed: 0 });
          const b = callPlan(ctx, store, { seed: 0 });
          check(JSON.stringify(a) === JSON.stringify(b) && a.rows.length > 0, () => ({ rule: 'seed 0 gave an empty or unstable plan' }));
        },
      ],
      [
        'negative-seed',
        3,
        (ctx) => {
          const { store } = axes(ctx, 4, 3);
          for (const seed of [-1, -7, -(2 ** 31), -(2 ** 53 - 1)]) {
            const a = callPlan(ctx, store, { seed });
            const b = callPlan(ctx, store, { seed });
            check(JSON.stringify(a) === JSON.stringify(b) && a.rows.length > 0, () => ({ rule: 'seed {} gave an empty or unstable plan', got: { details: [seed] } }));
          }
        },
      ],
      [
        'largest-safe-seed',
        3,
        (ctx) => {
          const { store } = axes(ctx, 4, 3);
          const a = callPlan(ctx, store, { seed: 2 ** 53 - 1 });
          const b = callPlan(ctx, store, { seed: 2 ** 53 - 1 });
          check(JSON.stringify(a) === JSON.stringify(b) && a.rows.length > 0, () => ({ rule: 'the largest safe integer seed gave an empty or unstable plan' }));
        },
      ],
      [
        'key-order-of-the-store-does-not-matter',
        4,
        (ctx) => {
          const { store } = axes(ctx, 4, 3);
          const reordered = JSON.parse(
            JSON.stringify(store, (_k, v) =>
              v && typeof v === 'object' && !Array.isArray(v)
                ? Object.fromEntries(Object.entries(v).reverse())
                : v,
            ),
          ) as StoreDoc;
          const a = callPlan(ctx, store, { seed: ctx.seed });
          const b = callPlan(ctx, reordered, { seed: ctx.seed });
          check(jsonEqual(
              a.rows.map((r) => r.values),
              b.rows.map((r) => r.values),
            ), () => ({ rule: 'writing the keys of the store in another order changed the rows' }));
        },
      ],
      [
        'key-order-of-a-seed-does-not-matter',
        4,
        (ctx) => {
          const { store, ids } = axes(ctx, 4, 2);
          const forward: Row = Object.fromEntries(ids.map((id) => [id, 'v1']));
          const backward: Row = Object.fromEntries([...ids].reverse().map((id) => [id, 'v1']));
          const a = callPlan(ctx, store, { seed: ctx.seed, seeds: [forward] });
          const b = callPlan(ctx, store, { seed: ctx.seed, seeds: [backward] });
          check(jsonEqual(a.rows.slice(1), b.rows.slice(1)), () => ({ rule: 'the order of the keys of a seed changed the new rows' }));
        },
      ],
      [
        'the-plan-does-not-change-its-inputs',
        3,
        (ctx) => {
          const { store } = axes(ctx, 4, 3);
          const seeds = randomSeeds(ctx, store, 2);
          const storeBefore = JSON.stringify(store);
          const seedsBefore = JSON.stringify(seeds);
          const options = { seed: ctx.seed, seeds, budget: 20 };
          const optionsBefore = JSON.stringify(options);
          callPlan(ctx, store, options);
          check(JSON.stringify(store) === storeBefore, () => ({ rule: 'the plan changed the store' }));
          check(JSON.stringify(seeds) === seedsBefore, () => ({ rule: 'the plan changed the seeds' }));
          check(JSON.stringify(options) === optionsBefore, () => ({ rule: 'the plan changed the options' }));
        },
      ],
      [
        'two-plans-share-no-object',
        4,
        (ctx) => {
          const { store } = axes(ctx, 3, 2);
          const a = callPlan(ctx, store, { seed: ctx.seed });
          const b = callPlan(ctx, store, { seed: ctx.seed });
          (a.rows[0] as Plan['rows'][number]).values.touched = 'yes';
          check(!('touched' in (b.rows[0] as Plan['rows'][number]).values), () => ({ rule: 'a change to one plan showed in the next plan' }));
        },
      ],
      [
        'a-reused-store-edited-in-place-is-read-again',
        5,
        (ctx) => {
          const { store, ids } = axes(ctx, 3, 2);
          const before = callPlan(ctx, store, { seed: ctx.seed });
          check(!before.rows.some((r) => r.values[ids[0] as string] === 'extra_value'), () => ({ rule: 'the value was in the store before it was added' }));
          (store.variables[0] as StoreDoc['variables'][number]).values.push({ id: 'extra_value' });
          const second = callPlan(ctx, store, { seed: ctx.seed });
          check(second.rows.some((r) => r.values[ids[0] as string] === 'extra_value'), () => ({ rule: 'the same store object, edited in place, gave a plan without the new value: an object cache returned a stale plan' }));
        },
      ],
    ],
  },
];
