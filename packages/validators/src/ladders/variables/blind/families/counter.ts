import type { ItemContext } from '../../bank/item';
import type { CoverageResult, Group, Row, StoreDoc } from '../../interface';
import {
  allRows,
  callCoverage,
  coverageError,
  errorNamed,
  makeStore,
  must,
  names,
  type Space,
  type Stem,
  show,
  spaceOf,
  subsetsOf,
  tupleKey,
  valueIds,
} from '../kit';

/** Family counter: R6 (allowed = extendable), R8 (partial rows), R10 (errors), R12 (exact counts, bigint, uncovered list). */

type Oracle = { allowed: Set<string>; covered: Set<string>; uncovered: string[] };

function subsetsFor(group: Group): string[][] {
  const size = Math.min(group.strength, group.variables.length);
  return subsetsOf(group.variables, size);
}

/** The brute force: distinct allowed tuples, distinct allowed tuples the rows hold, and those they miss. */
function oracle(space: Space, rows: Row[], groups: Group[]): Oracle {
  const full = allRows(space);
  const allowed = new Set<string>();
  const covered = new Set<string>();
  for (const g of groups) {
    for (const sub of subsetsFor(g)) {
      for (const r of full) allowed.add(tupleKey(r, sub));
      for (const r of rows) {
        if (sub.every((v) => r[v] !== undefined && space.dom[v]?.includes(r[v] as string))) {
          const k = tupleKey(r, sub);
          if (allowed.has(k)) covered.add(k);
        }
      }
    }
  }
  // A tuple held by a row is allowed only once every valid row has been projected, so check again after the loop.
  for (const k of [...covered]) if (!allowed.has(k)) covered.delete(k);
  return { allowed, covered, uncovered: [...allowed].filter((k) => !covered.has(k)) };
}

function same(value: number | bigint, want: number | bigint, label: string): void {
  must(
    BigInt(value) === BigInt(want),
    () => `${label} is ${String(value)}; the exact count is ${String(want)}`,
  );
}

function expectCounts(ctx: ItemContext, store: StoreDoc, rows: Row[], groups: Group[]): CoverageResult {
  const space = spaceOf(store);
  const want = oracle(space, rows, groups);
  const got = callCoverage(ctx, store, rows, groups);
  same(got.allowed, want.allowed.size, 'allowed');
  same(got.covered, want.covered.size, 'covered');
  return got;
}

function randomRows(ctx: ItemContext, store: StoreDoc, count: number, partial: boolean): Row[] {
  return Array.from({ length: count }, () => {
    const row: Row = {};
    for (const v of store.variables) {
      if (partial && ctx.rng.chance(0.4)) continue;
      row[v.id] = ctx.rng.pick(v.values).id;
    }
    return row;
  });
}

function small(ctx: ItemContext, arities: number[], forbidPairs = 0): StoreDoc {
  const ids = names(ctx.rng, arities.length) as string[];
  const store = makeStore({
    vars: ids.map((id, i) => ({ id, values: valueIds(arities[i] as number), shared: true })),
  });
  const seen = new Set<string>();
  while (seen.size < forbidPairs) {
    const i = ctx.rng.int(0, ids.length - 2);
    const j = ctx.rng.int(i + 1, ids.length - 1);
    const x = ctx.rng.pick(valueIds(arities[i] as number));
    const y = ctx.rng.pick(valueIds(arities[j] as number));
    const key = `${i}${x}${j}${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    store.impossible.push(
      ...makeStore({ vars: [], impossible: [[ids[i] as string, x, ids[j] as string, y]] }).impossible,
    );
  }
  return store;
}

const allIds = (store: StoreDoc): string[] => store.variables.map((v) => v.id);

/** C(n, k) * product of arities as a bigint, for unconstrained groups of equal arity. */
function closedForm(n: number, k: number, arity: number): bigint {
  let c = 1n;
  for (let i = 1; i <= k; i += 1) c = (c * BigInt(n - k + i)) / BigInt(i);
  return c * BigInt(arity) ** BigInt(k);
}

function choose(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let c = 1n;
  for (let i = 1; i <= k; i += 1) c = (c * BigInt(n - k + i)) / BigInt(i);
  return c;
}

function badGroups(make: (store: StoreDoc) => { groups: Group[]; what: string }) {
  return (ctx: ItemContext): void => {
    const store = small(ctx, [2, 2, 3]);
    const { groups, what } = make(store);
    errorNamed(coverageError(ctx, store, [], groups), 'RangeError', what);
  };
}

export const COUNTER_STEMS: readonly Stem[] = [
  {
    id: 'counter.exact',
    rules: ['R6', 'R8', 'R12'],
    family: 'counter',
    component: 'planner/counter',
    cause:
      'coverage counts the distinct allowed tuples and the distinct ones the rows hold, exactly, against a brute force',
    cases: [
      [
        'pairs-unconstrained',
        1,
        (ctx) => {
          const s = small(ctx, [2, 3, 2]);
          expectCounts(ctx, s, randomRows(ctx, s, 3, false), [{ variables: allIds(s), strength: 2 }]);
        },
      ],
      [
        'triples-unconstrained',
        2,
        (ctx) => {
          const s = small(ctx, [2, 3, 2, 2]);
          expectCounts(ctx, s, randomRows(ctx, s, 4, false), [{ variables: allIds(s), strength: 3 }]);
        },
      ],
      [
        'strength-one',
        1,
        (ctx) => {
          const s = small(ctx, [4, 3, 2]);
          expectCounts(ctx, s, randomRows(ctx, s, 2, false), [{ variables: allIds(s), strength: 1 }]);
        },
      ],
      [
        'mixed-arities',
        2,
        (ctx) => {
          const s = small(ctx, [5, 2, 4, 3]);
          expectCounts(ctx, s, randomRows(ctx, s, 6, false), [{ variables: allIds(s), strength: 2 }]);
        },
      ],
      [
        'with-pair-constraints',
        3,
        (ctx) => {
          const s = small(ctx, [3, 3, 3, 2], 6);
          expectCounts(ctx, s, randomRows(ctx, s, 5, false), [{ variables: allIds(s), strength: 2 }]);
        },
      ],
      [
        'with-dense-constraints',
        4,
        (ctx) => {
          const s = small(ctx, [3, 3, 3, 3], 18);
          expectCounts(ctx, s, randomRows(ctx, s, 5, false), [{ variables: allIds(s), strength: 2 }]);
        },
      ],
      [
        'with-a-triple-forbid',
        3,
        (ctx) => {
          const s = small(ctx, [2, 2, 2, 2]);
          const [a, b, c] = allIds(s) as [string, string, string];
          s.forbids = [{ forbid: { [a]: 'v0', [b]: 'v0', [c]: 'v0' } }];
          expectCounts(ctx, s, randomRows(ctx, s, 5, false), [{ variables: allIds(s), strength: 3 }]);
        },
      ],
      [
        'a-tuple-that-fits-pair-by-pair-but-no-row-is-not-allowed',
        4,
        (ctx) => {
          const [a, b, c] = names(ctx.rng, 3) as [string, string, string];
          const s = makeStore({
            vars: [
              { id: a, values: ['a0', 'a1'], shared: true },
              { id: b, values: ['b0', 'b1'], shared: true },
              { id: c, values: ['c0', 'c1'], shared: true },
            ],
            impossible: [
              [a, 'a1', c, 'c0'],
              [b, 'b1', c, 'c1'],
            ],
          });
          const got = expectCounts(
            ctx,
            s,
            [{ [a]: 'a1', [b]: 'b1', [c]: 'c0' }],
            [{ variables: [a, b], strength: 2 }],
          );
          same(got.allowed, 3, 'allowed pairs of a and b');
        },
      ],
      [
        'partial-rows-credit-what-they-assign',
        3,
        (ctx) => {
          const s = small(ctx, [2, 3, 2, 2]);
          expectCounts(ctx, s, randomRows(ctx, s, 8, true), [{ variables: allIds(s), strength: 2 }]);
        },
      ],
      [
        'partial-rows-at-strength-three',
        4,
        (ctx) => {
          const s = small(ctx, [2, 2, 3, 2, 2]);
          expectCounts(ctx, s, randomRows(ctx, s, 10, true), [{ variables: allIds(s), strength: 3 }]);
        },
      ],
      [
        'overlapping-groups-count-once',
        4,
        (ctx) => {
          const s = small(ctx, [2, 3, 2, 2, 2]);
          const ids = allIds(s);
          expectCounts(ctx, s, randomRows(ctx, s, 5, false), [
            { variables: ids.slice(0, 4), strength: 2 },
            { variables: ids.slice(1, 5), strength: 2 },
            { variables: ids.slice(0, 3), strength: 3 },
          ]);
        },
      ],
      [
        'the-same-group-twice',
        3,
        (ctx) => {
          const s = small(ctx, [3, 3, 2]);
          const g = { variables: allIds(s), strength: 2 };
          expectCounts(ctx, s, randomRows(ctx, s, 4, false), [g, { ...g }]);
        },
      ],
      [
        'repeated-rows-count-once',
        3,
        (ctx) => {
          const s = small(ctx, [3, 3, 2]);
          const rows = randomRows(ctx, s, 2, false);
          const g: Group[] = [{ variables: allIds(s), strength: 2 }];
          const once = expectCounts(ctx, s, rows, g);
          const many = expectCounts(ctx, s, [...rows, ...rows, ...rows.map((r) => ({ ...r }))], g);
          same(many.covered, once.covered, 'covered with repeated rows');
        },
      ],
      [
        'no-rows',
        1,
        (ctx) => {
          const s = small(ctx, [3, 2, 2]);
          const got = expectCounts(ctx, s, [], [{ variables: allIds(s), strength: 2 }]);
          same(got.covered, 0, 'covered with no rows');
        },
      ],
      [
        'every-valid-row',
        2,
        (ctx) => {
          const s = small(ctx, [2, 3, 2], 2);
          const rows = allRows(spaceOf(s));
          const got = expectCounts(ctx, s, rows, [{ variables: allIds(s), strength: 2 }]);
          same(got.covered, got.allowed, 'covered with every valid row');
        },
      ],
      [
        'strength-above-the-group-size',
        3,
        (ctx) => {
          const s = small(ctx, [2, 3, 2]);
          expectCounts(ctx, s, randomRows(ctx, s, 3, false), [
            { variables: allIds(s).slice(0, 2), strength: 5 },
          ]);
        },
      ],
      [
        'group-of-one-variable',
        2,
        (ctx) => {
          const s = small(ctx, [4, 3]);
          expectCounts(ctx, s, randomRows(ctx, s, 2, false), [
            { variables: allIds(s).slice(0, 1), strength: 3 },
          ]);
        },
      ],
      [
        'rows-with-unlisted-values-credit-nothing',
        4,
        (ctx) => {
          const s = small(ctx, [2, 2, 2]);
          const [a, b, c] = allIds(s) as [string, string, string];
          const got = expectCounts(
            ctx,
            s,
            [{ [a]: 'v0', [b]: 'not_a_value', [c]: 'v1' }],
            [{ variables: [a, b, c], strength: 2 }],
          );
          same(got.covered, 1, 'covered by a row with one unlisted value (only the pair a, c is held)');
        },
      ],
      [
        'unapproved-values-are-not-in-the-space',
        4,
        (ctx) => {
          const [a, b] = names(ctx.rng, 2) as [string, string];
          const s = makeStore({
            vars: [
              { id: a, values: ['v0', 'v1', { id: 'proposed', approved: false }], shared: true },
              { id: b, values: ['v0', 'v1'], shared: true },
            ],
          });
          const got = expectCounts(
            ctx,
            s,
            [{ [a]: 'proposed', [b]: 'v0' }],
            [{ variables: [a, b], strength: 2 }],
          );
          same(got.allowed, 4, 'allowed pairs without the unapproved value');
          same(got.covered, 0, 'pairs held by a row with an unapproved value');
        },
      ],
      [
        'random-shape-one',
        3,
        (ctx) => {
          const s = small(
            ctx,
            [ctx.rng.int(2, 4), ctx.rng.int(2, 4), ctx.rng.int(2, 3), ctx.rng.int(2, 3)],
            4,
          );
          expectCounts(ctx, s, randomRows(ctx, s, 6, true), [
            { variables: allIds(s), strength: 2 },
            { variables: allIds(s).slice(1), strength: 3 },
          ]);
        },
      ],
      [
        'random-shape-two',
        4,
        (ctx) => {
          const s = small(
            ctx,
            [ctx.rng.int(2, 3), ctx.rng.int(2, 3), ctx.rng.int(2, 3), ctx.rng.int(2, 3), ctx.rng.int(2, 3)],
            8,
          );
          expectCounts(ctx, s, randomRows(ctx, s, 9, true), [{ variables: allIds(s), strength: 3 }]);
        },
      ],
      [
        'random-shape-three',
        5,
        (ctx) => {
          const s = small(ctx, [3, 3, 3, 3, 2, 2], 14);
          const ids = allIds(s);
          expectCounts(ctx, s, randomRows(ctx, s, 12, true), [
            { variables: ids, strength: 2 },
            { variables: ids.slice(0, 4), strength: 4 },
            { variables: ids.slice(2), strength: 1 },
          ]);
        },
      ],
    ],
  },
  {
    id: 'counter.uncovered',
    rules: ['R12'],
    family: 'counter',
    component: 'planner/counter',
    cause:
      'the uncovered list holds distinct allowed tuples that no row holds, exactly the smaller of the limit and their count',
    cases: [
      [
        'limit-below-the-count',
        3,
        (ctx) => {
          const s = small(ctx, [3, 3, 2]);
          const g: Group[] = [{ variables: allIds(s), strength: 2 }];
          const want = oracle(spaceOf(s), [], g);
          const got = callCoverage(ctx, s, [], g, { uncovered: 5 });
          must(
            Array.isArray(got.uncovered) && got.uncovered.length === 5,
            () =>
              `uncovered has ${got.uncovered?.length} tuples; limit 5 of ${want.uncovered.length} was asked`,
          );
        },
      ],
      [
        'limit-above-the-count-lists-all',
        3,
        (ctx) => {
          const s = small(ctx, [2, 2, 2]);
          const g: Group[] = [{ variables: allIds(s), strength: 2 }];
          const rows = randomRows(ctx, s, 2, false);
          const want = oracle(spaceOf(s), rows, g);
          const got = callCoverage(ctx, s, rows, g, { uncovered: 1000 });
          must(
            got.uncovered?.length === want.uncovered.length,
            () => `uncovered has ${got.uncovered?.length} tuples; ${want.uncovered.length} are missing`,
          );
        },
      ],
      [
        'limit-zero-lists-none',
        4,
        (ctx) => {
          const s = small(ctx, [2, 3]);
          const got = callCoverage(ctx, s, [], [{ variables: allIds(s), strength: 2 }], { uncovered: 0 });
          must(
            Array.isArray(got.uncovered) && got.uncovered.length === 0,
            () => `uncovered is ${show(got.uncovered)} for limit 0`,
          );
        },
      ],
      [
        'listed-tuples-are-distinct',
        3,
        (ctx) => {
          const s = small(ctx, [3, 2, 2, 2]);
          const ids = allIds(s);
          const g: Group[] = [
            { variables: ids, strength: 2 },
            { variables: ids.slice(0, 3), strength: 2 },
          ];
          const got = callCoverage(ctx, s, [], g, { uncovered: 1000 });
          const keys = (got.uncovered ?? []).map((t) => JSON.stringify(Object.entries(t).sort()));
          must(new Set(keys).size === keys.length, () => 'the uncovered list repeats a tuple');
        },
      ],
      [
        'listed-tuples-are-allowed-and-unheld',
        4,
        (ctx) => {
          const s = small(ctx, [3, 3, 2], 4);
          const space = spaceOf(s);
          const g: Group[] = [{ variables: allIds(s), strength: 2 }];
          const rows = randomRows(ctx, s, 3, true);
          const want = oracle(space, rows, g);
          const got = callCoverage(ctx, s, rows, g, { uncovered: 1000 });
          const missing = new Set(want.uncovered);
          for (const t of got.uncovered ?? []) {
            const vars = Object.keys(t);
            const k = tupleKey(t, vars);
            must(
              missing.has(k),
              () => `the listed tuple ${show(t)} is held by a row or no valid row can hold it`,
            );
          }
          must(
            (got.uncovered ?? []).length === want.uncovered.length,
            () => `${got.uncovered?.length} tuples listed; ${want.uncovered.length} are missing`,
          );
        },
      ],
      [
        'nothing-missing-lists-nothing',
        3,
        (ctx) => {
          const s = small(ctx, [2, 2, 2]);
          const rows = allRows(spaceOf(s));
          const got = callCoverage(ctx, s, rows, [{ variables: allIds(s), strength: 2 }], { uncovered: 10 });
          must(
            Array.isArray(got.uncovered) && got.uncovered.length === 0,
            () => `uncovered is ${show(got.uncovered)} although the rows hold every tuple`,
          );
        },
      ],
    ],
  },
  {
    id: 'counter.errors',
    rules: ['R10'],
    family: 'counter',
    component: 'planner/counter',
    cause:
      'a group with an unknown or repeated variable, or a strength that is not a positive whole number, raises a RangeError that names it',
    cases: [
      [
        'unknown-variable',
        2,
        badGroups(() => ({
          groups: [{ variables: ['nowhere_at_all', 'also_missing'], strength: 2 }],
          what: 'nowhere_at_all',
        })),
      ],
      [
        'unknown-variable-among-known',
        3,
        badGroups((s) => ({
          groups: [{ variables: [...allIds(s), 'ghost_variable'], strength: 2 }],
          what: 'ghost_variable',
        })),
      ],
      [
        'unknown-variable-in-the-second-group',
        3,
        badGroups((s) => ({
          groups: [
            { variables: allIds(s), strength: 2 },
            { variables: ['phantom'], strength: 1 },
          ],
          what: 'phantom',
        })),
      ],
      [
        'duplicate-variable',
        3,
        badGroups((s) => ({
          groups: [
            {
              variables: [allIds(s)[0] as string, allIds(s)[1] as string, allIds(s)[0] as string],
              strength: 2,
            },
          ],
          what: allIds(s)[0] as string,
        })),
      ],
      [
        'strength-zero',
        2,
        badGroups((s) => ({ groups: [{ variables: allIds(s), strength: 0 }], what: 'strength' })),
      ],
      [
        'strength-negative',
        2,
        badGroups((s) => ({ groups: [{ variables: allIds(s), strength: -2 }], what: 'strength' })),
      ],
      [
        'strength-fraction',
        3,
        badGroups((s) => ({ groups: [{ variables: allIds(s), strength: 1.5 }], what: 'strength' })),
      ],
      [
        'strength-not-a-number',
        3,
        badGroups((s) => ({ groups: [{ variables: allIds(s), strength: Number.NaN }], what: 'strength' })),
      ],
      [
        'strength-infinite',
        4,
        badGroups((s) => ({
          groups: [{ variables: allIds(s), strength: Number.POSITIVE_INFINITY }],
          what: 'strength',
        })),
      ],
    ],
  },
  {
    id: 'counter.exact-beyond-safe',
    rules: ['R12'],
    family: 'counter',
    component: 'planner/counter',
    cause: 'counts above the safe integer range are exact bigint values, computed without enumerating tuples',
    heavy: true,
    cases: [
      ['binary-sixty-variables-strength-thirty', 5, (ctx) => beyond(ctx, 60, 2, 30)],
      ['ternary-fifty-variables-strength-fifteen', 5, (ctx) => beyond(ctx, 50, 3, 15)],
      ['quaternary-forty-variables-strength-twelve', 5, (ctx) => beyond(ctx, 40, 4, 12)],
      [
        'just-inside-the-safe-range',
        4,
        (ctx) => {
          // C(200, 3) * 8 is about 1e7: exact as a number or as a bigint.
          const store = wide(ctx, 200, 2);
          const got = callCoverage(ctx, store, [], [{ variables: allIds(store), strength: 3 }]);
          same(got.allowed, closedForm(200, 3, 2), 'allowed');
        },
      ],
      [
        'covered-by-two-rows-beyond-the-safe-range',
        5,
        (ctx) => {
          const n = 60;
          const k = 30;
          const store = wide(ctx, n, 2);
          const ids = allIds(store);
          const a: Row = Object.fromEntries(ids.map((id) => [id, 'v0']));
          // The second row differs from the first in the last ten variables: the agree set has 50 variables.
          const b: Row = Object.fromEntries(ids.map((id, i) => [id, i >= 50 ? 'v1' : 'v0']));
          const got = callCoverage(ctx, store, [a, b], [{ variables: ids, strength: k }]);
          const want = 2n * choose(n, k) - choose(50, k);
          same(got.covered, want, 'covered');
          must(
            typeof got.covered === 'bigint',
            () => `covered is a ${typeof got.covered} although ${want} exceeds the safe integer range`,
          );
        },
      ],
    ],
  },
];

function wide(_ctx: ItemContext, n: number, arity: number): StoreDoc {
  const ids = Array.from({ length: n }, (_, i) => `q${i}`);
  return makeStore({ vars: ids.map((id) => ({ id, values: valueIds(arity), shared: true })) });
}

function beyond(ctx: ItemContext, n: number, arity: number, k: number): void {
  const store = wide(ctx, n, arity);
  const want = closedForm(n, k, arity);
  must(
    want > BigInt(Number.MAX_SAFE_INTEGER),
    () => 'the bank built a count inside the safe range for a bigint item',
  );
  const got = callCoverage(ctx, store, [], [{ variables: allIds(store), strength: k }]);
  must(
    typeof got.allowed === 'bigint',
    () =>
      `allowed is a ${typeof got.allowed} (${String(got.allowed)}); ${want} exceeds the safe integer range and must be a bigint`,
  );
  same(got.allowed, want, 'allowed');
}
