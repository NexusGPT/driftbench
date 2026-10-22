import type { ItemContext } from '../../bank/item';
import type { Rng } from '../../bank/util';
import type { Row, StoreDoc } from '../../interface';
import {
  allRows,
  assertCovered,
  assertRowsSound,
  callPlan,
  jsonEqual,
  makeStore,
  must,
  names,
  need,
  newRows,
  type Stem,
  show,
  spaceOf,
  valueIds,
} from '../kit';
import { lex } from '../lexicon';
import { discover, OWNER_DATE, pairOf, samePair, type ToolSpec } from '../scene';

/** Family impossible-pairs: R5 (owner pairs), R6 (extendability), R7, Impossible combinations, Approval. */

type Shape = { arities: number[]; shared?: boolean[] };

function storeFor(rng: Rng, shape: Shape, extra: Partial<Parameters<typeof makeStore>[0]> = {}): StoreDoc {
  const ids = names(rng, shape.arities.length);
  return makeStore({
    vars: shape.arities.map((a, i) => ({
      id: ids[i] as string,
      values: valueIds(a),
      shared: shape.shared ? shape.shared[i] : true,
    })),
    ...extra,
  });
}

/** Plans the store and checks the new rows and the cover of every allowed required tuple. */
function planAndCheck(ctx: ItemContext, store: StoreDoc, seeds: Row[] = []) {
  const space = spaceOf(store);
  const plan = callPlan(ctx, store, { seed: ctx.seed, seeds });
  assertRowsSound(space, plan, seeds);
  assertCovered(space, plan, seeds);
  return { space, plan };
}

/** Distinct pairs on different variables that a hidden valid row does not hold, so the space stays satisfiable. */
function plantedPairs(rng: Rng, store: StoreDoc, count: number): Array<[string, string, string, string]> {
  const vars = store.variables;
  const witness: Row = {};
  for (const v of vars) witness[v.id] = rng.pick(v.values).id;
  const pool: Array<[string, string, string, string]> = [];
  for (let i = 0; i < vars.length; i += 1) {
    for (let j = i + 1; j < vars.length; j += 1) {
      for (const x of (vars[i] as StoreDoc['variables'][number]).values) {
        for (const y of (vars[j] as StoreDoc['variables'][number]).values) {
          const a = (vars[i] as StoreDoc['variables'][number]).id;
          const b = (vars[j] as StoreDoc['variables'][number]).id;
          if (witness[a] === x.id && witness[b] === y.id) continue;
          pool.push([a, x.id, b, y.id]);
        }
      }
    }
  }
  return rng.sample(pool, Math.min(count, pool.length));
}

function warningCodes(plan: { warnings?: Array<{ code: string }> }): string[] {
  return (plan.warnings ?? []).map((w) => w.code);
}

const ownerTools = (rng: Rng): ToolSpec[] => {
  const [t1, t2, f1, f2] = names(rng, 4);
  return [
    { tool: `${t1}_tool`, field: `${f1}_kind`, values: [lex('alpha'), lex('beta'), lex('gamma')] },
    { tool: `${t2}_tool`, field: `${f2}_mode`, values: [lex('north'), lex('south')] },
  ];
};

export const IMPOSSIBLE_STEMS: readonly Stem[] = [
  {
    id: 'impossible.never-appears',
    rules: ['R6', 'R7'],
    family: 'impossible-pairs',
    component: 'planner/constraints',
    cause: 'the planner never emits a row that holds a forbidden pair and still covers every allowed tuple',
    cases: [
      [
        'one-pair',
        1,
        (ctx) => {
          const store = storeFor(ctx.rng, { arities: [2, 2, 3] });
          store.impossible.push(
            ...makeStore({ vars: [], impossible: plantedPairs(ctx.rng, store, 1) }).impossible,
          );
          planAndCheck(ctx, store);
        },
      ],
      [
        'several-pairs',
        2,
        (ctx) => {
          const store = storeFor(ctx.rng, { arities: [3, 3, 2, 2] });
          store.impossible.push(
            ...makeStore({ vars: [], impossible: plantedPairs(ctx.rng, store, 5) }).impossible,
          );
          planAndCheck(ctx, store);
        },
      ],
      [
        'pairs-on-shared-axes-only',
        2,
        (ctx) => {
          const store = storeFor(ctx.rng, { arities: [3, 3, 3] });
          store.impossible.push(
            ...makeStore({ vars: [], impossible: plantedPairs(ctx.rng, store, 4) }).impossible,
          );
          planAndCheck(ctx, store);
        },
      ],
      [
        'pairs-on-details',
        2,
        (ctx) => {
          const store = storeFor(ctx.rng, { arities: [3, 3, 3], shared: [false, false, false] });
          store.impossible.push(
            ...makeStore({ vars: [], impossible: plantedPairs(ctx.rng, store, 4) }).impossible,
          );
          planAndCheck(ctx, store);
        },
      ],
      [
        'dense-pairs',
        3,
        (ctx) => {
          const store = storeFor(ctx.rng, { arities: [4, 4, 3, 3, 2] });
          store.impossible.push(
            ...makeStore({ vars: [], impossible: plantedPairs(ctx.rng, store, 40) }).impossible,
          );
          planAndCheck(ctx, store);
        },
      ],
      [
        'pair-inside-a-rule',
        3,
        (ctx) => {
          const store = storeFor(ctx.rng, { arities: [3, 3, 3, 2], shared: [false, false, false, false] });
          const [a, b, c] = store.variables.map((v) => v.id) as [string, string, string];
          store.rules.push({ id: 'rule.inner', variables: [a, b, c] });
          store.impossible.push(
            ...makeStore({ vars: [], impossible: plantedPairs(ctx.rng, store, 4) }).impossible,
          );
          planAndCheck(ctx, store);
        },
      ],
      [
        'pair-extendable-only-through-a-third-variable',
        4,
        (ctx) => {
          // a1 forces c2 (c1 is forbidden with a1); b1 forces c1: the tuple (a1, b1) is fine pair by pair and
          // has no valid row, so it is not a target and the plan must still finish.
          const [a, b, c] = names(ctx.rng, 3);
          const store = makeStore({
            vars: [
              { id: a as string, values: ['a0', 'a1'], shared: true },
              { id: b as string, values: ['b0', 'b1'], shared: true },
              { id: c as string, values: ['c0', 'c1'], shared: true },
            ],
            impossible: [
              [a as string, 'a1', c as string, 'c0'],
              [b as string, 'b1', c as string, 'c1'],
            ],
          });
          const { plan } = planAndCheck(ctx, store);
          for (const r of newRows(plan)) {
            must(
              !(r.values[a as string] === 'a1' && r.values[b as string] === 'b1'),
              () => `a row holds a1 with b1, which no valid row can: ${show(r.values)}`,
            );
          }
        },
      ],
    ],
  },
  {
    id: 'impossible.sizes',
    rules: ['R7', 'Impossible'],
    family: 'impossible-pairs',
    component: 'planner/constraints',
    cause:
      'a constraint of any size (one value, a pair, three values) removes every row that holds all of its cells',
    cases: [
      [
        'one-value',
        2,
        (ctx) => {
          const [a, b] = names(ctx.rng, 2);
          const store = makeStore({
            vars: [
              { id: a as string, values: ['p', 'q', 'r'], shared: true },
              { id: b as string, values: ['s', 't'], shared: true },
            ],
            forbids: [{ forbid: { [a as string]: 'q' } }],
          });
          const { plan } = planAndCheck(ctx, store);
          for (const r of newRows(plan))
            must(r.values[a as string] !== 'q', () => `row ${r.id} holds the forbidden value q`);
          must(
            warningCodes(plan).includes('value_unreachable'),
            () => `no value_unreachable warning; warnings: ${show(plan.warnings)}`,
          );
        },
      ],
      [
        'three-values',
        3,
        (ctx) => {
          const [a, b, c] = names(ctx.rng, 3) as [string, string, string];
          const store = makeStore({
            vars: [
              { id: a, values: ['a0', 'a1'], shared: true },
              { id: b, values: ['b0', 'b1'], shared: true },
              { id: c, values: ['c0', 'c1'], shared: true },
            ],
            forbids: [{ forbid: { [a]: 'a1', [b]: 'b1', [c]: 'c1' } }],
          });
          const { plan } = planAndCheck(ctx, store);
          for (const r of newRows(plan)) {
            must(
              !(r.values[a] === 'a1' && r.values[b] === 'b1' && r.values[c] === 'c1'),
              () => `row ${r.id} holds the forbidden triple`,
            );
          }
        },
      ],
      [
        'triple-leaves-every-pair-allowed',
        4,
        (ctx) => {
          // Every pair of the forbidden triple is still a target: some valid row holds it with another third value.
          const [a, b, c] = names(ctx.rng, 3) as [string, string, string];
          const store = makeStore({
            vars: [
              { id: a, values: ['a0', 'a1'], shared: true },
              { id: b, values: ['b0', 'b1'], shared: true },
              { id: c, values: ['c0', 'c1'], shared: true },
            ],
            forbids: [{ forbid: { [a]: 'a1', [b]: 'b1', [c]: 'c1' } }],
          });
          const { plan } = planAndCheck(ctx, store);
          const held = (x: string, vx: string, y: string, vy: string) =>
            plan.rows.some((r) => r.values[x] === vx && r.values[y] === vy);
          must(
            held(a, 'a1', b, 'b1'),
            () => 'no row holds a1 with b1, a pair that a valid row holds when c is c0',
          );
          must(held(a, 'a1', c, 'c1'), () => 'no row holds a1 with c1');
          must(held(b, 'b1', c, 'c1'), () => 'no row holds b1 with c1');
        },
      ],
      [
        'pair-through-the-forbids-field',
        2,
        (ctx) => {
          const store = storeFor(ctx.rng, { arities: [3, 3, 2] });
          const [a, b] = store.variables.map((v) => v.id) as [string, string];
          store.forbids = [{ forbid: { [a]: 'v0', [b]: 'v1' } }, { forbid: { [a]: 'v2', [b]: 'v2' } }];
          const { plan } = planAndCheck(ctx, store);
          for (const r of newRows(plan)) {
            must(
              !(r.values[a] === 'v0' && r.values[b] === 'v1'),
              () => `row ${r.id} holds the first forbidden pair`,
            );
            must(
              !(r.values[a] === 'v2' && r.values[b] === 'v2'),
              () => `row ${r.id} holds the second forbidden pair`,
            );
          }
        },
      ],
      [
        'reversed-pair-is-the-same-pair',
        3,
        (ctx) => {
          const one = storeFor(ctx.rng, { arities: [3, 3, 2] });
          const [a, b] = one.variables.map((v) => v.id) as [string, string];
          const two = JSON.parse(JSON.stringify(one)) as StoreDoc;
          one.impossible = makeStore({ vars: [], impossible: [[a, 'v0', b, 'v1']] }).impossible;
          two.impossible = makeStore({ vars: [], impossible: [[b, 'v1', a, 'v0']] }).impossible;
          const p1 = callPlan(ctx, one, { seed: ctx.seed });
          const p2 = callPlan(ctx, two, { seed: ctx.seed });
          must(
            jsonEqual(p1.rows, p2.rows),
            () => 'the same pair written in the other order gives a different plan',
          );
        },
      ],
      [
        'duplicate-pair-changes-nothing',
        3,
        (ctx) => {
          const one = storeFor(ctx.rng, { arities: [3, 3, 2] });
          const [a, b] = one.variables.map((v) => v.id) as [string, string];
          const two = JSON.parse(JSON.stringify(one)) as StoreDoc;
          one.impossible = makeStore({ vars: [], impossible: [[a, 'v2', b, 'v0']] }).impossible;
          two.impossible = makeStore({
            vars: [],
            impossible: [
              [a, 'v2', b, 'v0'],
              [b, 'v0', a, 'v2'],
              [a, 'v2', b, 'v0'],
            ],
          }).impossible;
          const p1 = callPlan(ctx, one, { seed: ctx.seed });
          const p2 = callPlan(ctx, two, { seed: ctx.seed });
          must(
            jsonEqual(p1.rows, p2.rows),
            () => 'a pair written three times gives a different plan from the pair written once',
          );
        },
      ],
      [
        'same-variable-pair-excludes-nothing',
        4,
        (ctx) => {
          const one = storeFor(ctx.rng, { arities: [3, 2, 2] });
          const a = (one.variables[0] as StoreDoc['variables'][number]).id;
          const two = JSON.parse(JSON.stringify(one)) as StoreDoc;
          two.impossible = makeStore({ vars: [], impossible: [[a, 'v0', a, 'v1']] }).impossible;
          const p1 = callPlan(ctx, one, { seed: ctx.seed });
          const p2 = callPlan(ctx, two, { seed: ctx.seed });
          must(
            jsonEqual(p1.rows, p2.rows),
            () =>
              'a pair of two values of one variable changed the plan; a row holds one value of a variable, so it excludes nothing',
          );
          assertCovered(spaceOf(two), p2, []);
        },
      ],
    ],
  },
  {
    id: 'impossible.approval',
    rules: ['Approval', 'R7'],
    family: 'impossible-pairs',
    component: 'planner/constraints',
    cause: 'a constraint that is not approved plans nothing, and one with no flag counts',
    cases: [
      [
        'unapproved-constraint-plans-nothing',
        2,
        (ctx) => {
          const [a, b] = names(ctx.rng, 2) as [string, string];
          const mk = (flag: boolean | undefined) =>
            makeStore({
              vars: [
                { id: a, values: ['a0', 'a1'], shared: true },
                { id: b, values: ['b0', 'b1'], shared: true },
              ],
              forbids: [
                { forbid: { [a]: 'a0', [b]: 'b0' }, ...(flag === undefined ? {} : { approved: flag }) },
              ],
            });
          const plan = callPlan(ctx, mk(false), { seed: ctx.seed });
          must(
            plan.rows.some((r) => r.values[a] === 'a0' && r.values[b] === 'b0'),
            () => 'the pair a0, b0 is ruled out by a constraint nobody approved; the plan must still hold it',
          );
        },
      ],
      [
        'approved-constraint-counts',
        1,
        (ctx) => {
          const [a, b] = names(ctx.rng, 2) as [string, string];
          const store = makeStore({
            vars: [
              { id: a, values: ['a0', 'a1'], shared: true },
              { id: b, values: ['b0', 'b1'], shared: true },
            ],
            forbids: [{ forbid: { [a]: 'a0', [b]: 'b0' }, approved: true }],
          });
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          must(
            !plan.rows.some((r) => r.values[a] === 'a0' && r.values[b] === 'b0'),
            () => 'a row holds an approved forbidden pair',
          );
        },
      ],
      [
        'constraint-without-a-flag-counts',
        2,
        (ctx) => {
          const [a, b] = names(ctx.rng, 2) as [string, string];
          const store = makeStore({
            vars: [
              { id: a, values: ['a0', 'a1', 'a2'], shared: true },
              { id: b, values: ['b0', 'b1'], shared: true },
            ],
            impossible: [[a, 'a2', b, 'b1']],
          });
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          must(
            !plan.rows.some((r) => r.values[a] === 'a2' && r.values[b] === 'b1'),
            () => 'a row holds a pair with no approval flag, which counts as approved',
          );
        },
      ],
      [
        'unapproved-constraint-leaves-its-tuples-targets',
        3,
        (ctx) => {
          const [a, b, c] = names(ctx.rng, 3) as [string, string, string];
          const store = makeStore({
            vars: [
              { id: a, values: ['a0', 'a1'], shared: true },
              { id: b, values: ['b0', 'b1'], shared: true },
              { id: c, values: ['c0', 'c1'], shared: true },
            ],
            forbids: [
              { forbid: { [a]: 'a0', [b]: 'b0' }, approved: false },
              { forbid: { [b]: 'b1', [c]: 'c1' }, approved: true },
            ],
          });
          const space = spaceOf(store);
          must(space.forbids.length === 1, () => 'the bank built the space wrongly');
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          assertRowsSound(space, plan, []);
          assertCovered(space, plan, []);
          must(
            plan.rows.some((r) => r.values[a] === 'a0' && r.values[b] === 'b0'),
            () => 'a0 with b0 is a target again once its constraint is not approved',
          );
        },
      ],
    ],
  },
  {
    id: 'impossible.unsatisfiable',
    rules: ['R7'],
    family: 'impossible-pairs',
    component: 'planner/constraints',
    cause:
      'a space with no valid row gives no new rows or an error that names the conflict, and never an invalid row or a hang',
    cases: [
      ['every-pair-of-two-binary-variables', 3, (ctx) => unsat(ctx, [2, 2], 'pairs')],
      ['every-value-of-one-variable', 3, (ctx) => unsat(ctx, [2, 3], 'singles')],
      ['three-variables-with-a-cyclic-conflict', 4, (ctx) => unsat(ctx, [2, 2, 2], 'cycle')],
      [
        'unsatisfiable-space-with-seeds',
        4,
        (ctx) => {
          const [a, b] = names(ctx.rng, 2) as [string, string];
          const store = makeStore({
            vars: [
              { id: a, values: ['a0', 'a1'], shared: true },
              { id: b, values: ['b0', 'b1'], shared: true },
            ],
            forbids: [
              { forbid: { [a]: 'a0', [b]: 'b0' } },
              { forbid: { [a]: 'a0', [b]: 'b1' } },
              { forbid: { [a]: 'a1', [b]: 'b0' } },
              { forbid: { [a]: 'a1', [b]: 'b1' } },
            ],
          });
          const seeds: Row[] = [{ [a]: 'a0', [b]: 'b0' }];
          let rows: ReturnType<typeof callPlan>['rows'] | undefined;
          const run = need(ctx, 'plan');
          try {
            rows = (run(store, { seed: ctx.seed, seeds }) as ReturnType<typeof callPlan>).rows;
          } catch (error) {
            must(
              (error as Error).message.length > 0,
              () => 'the plan threw an error with no message; it should name the conflict',
            );
            return;
          }
          must(
            newRows({ rows }).length === 0,
            () => `an unsatisfiable space gave ${newRows({ rows }).length} new rows`,
          );
          must(rows[0]?.kind === 'seed', () => 'the seed row is not kept first');
        },
      ],
    ],
  },
  {
    id: 'impossible.unreachable-value',
    rules: ['R7'],
    family: 'impossible-pairs',
    component: 'planner/constraints',
    cause:
      'a value that no valid row can hold gets the warning value_unreachable and is left out of the rows',
    cases: [
      [
        'forbidden-alone',
        2,
        (ctx) => {
          const [a, b] = names(ctx.rng, 2) as [string, string];
          const store = makeStore({
            vars: [
              { id: a, values: ['a0', 'a1', 'a2'], shared: true },
              { id: b, values: ['b0', 'b1'], shared: true },
            ],
            forbids: [{ forbid: { [a]: 'a2' } }],
          });
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          must(
            warningCodes(plan).includes('value_unreachable'),
            () => `no value_unreachable in ${show(plan.warnings)}`,
          );
          must(!plan.rows.some((r) => r.values[a] === 'a2'), () => 'a row holds the unreachable value');
        },
      ],
      [
        'forbidden-with-every-value-of-another-variable',
        3,
        (ctx) => {
          const [a, b] = names(ctx.rng, 2) as [string, string];
          const store = makeStore({
            vars: [
              { id: a, values: ['a0', 'a1'], shared: true },
              { id: b, values: ['b0', 'b1'], shared: true },
            ],
            impossible: [
              [a, 'a1', b, 'b0'],
              [a, 'a1', b, 'b1'],
            ],
          });
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          must(
            warningCodes(plan).includes('value_unreachable'),
            () => `no value_unreachable in ${show(plan.warnings)}`,
          );
          assertRowsSound(spaceOf(store), plan, []);
        },
      ],
      [
        'no-warning-when-every-value-can-be-held',
        2,
        (ctx) => {
          const store = storeFor(ctx.rng, { arities: [3, 3] });
          const [a, b] = store.variables.map((v) => v.id) as [string, string];
          store.impossible = makeStore({ vars: [], impossible: [[a, 'v0', b, 'v0']] }).impossible;
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          must(
            !warningCodes(plan).includes('value_unreachable'),
            () => 'a warning value_unreachable for a store where every value can be held',
          );
        },
      ],
      [
        'unreachable-because-the-only-value-of-another-variable-excludes-it',
        4,
        (ctx) => {
          const [a, b, c] = names(ctx.rng, 3) as [string, string, string];
          const store = makeStore({
            vars: [
              { id: a, values: ['a0', 'a1'], shared: true },
              { id: b, values: ['b0'], shared: true },
              { id: c, values: ['c0', 'c1'], shared: true },
            ],
            impossible: [[a, 'a1', b, 'b0']],
          });
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          must(
            warningCodes(plan).includes('value_unreachable'),
            () => 'a1 cannot be held because b has one value and it is forbidden with a1; no warning',
          );
          must(!plan.rows.some((r) => r.values[a] === 'a1'), () => 'a row holds a1');
        },
      ],
    ],
  },
  {
    id: 'impossible.owner',
    rules: ['R5'],
    family: 'impossible-pairs',
    component: 'store/owner',
    cause:
      'the owner can add impossible pairs with their words and date, repeats and reversals are one pair, and a pair naming something missing is refused with a reason',
    cases: [
      [
        'owner-pair-is-added-with-provenance',
        2,
        (ctx) => {
          const d = discover(ctx, ownerTools(ctx.rng));
          const [v1, v2] = d.ids as [string, string];
          const store = d.build({
            owner: {
              impossible: [pairOf([v1, lex('alpha')], [v2, lex('north')], 'Never together, says the owner.')],
            },
          });
          const hit = store.impossible.find((p) => samePair(p, [v1, lex('alpha')], [v2, lex('north')]));
          must(!!hit, () => `the owner pair is not in the store: ${show(store.impossible)}`);
          const own = hit?.provenance.find((p) => p.kind === 'owner');
          must(
            own?.kind === 'owner' &&
              own.words === 'Never together, says the owner.' &&
              own.date === OWNER_DATE,
            () => `owner provenance is ${show(hit?.provenance)}`,
          );
        },
      ],
      [
        'owner-pair-reversed-is-one-pair',
        3,
        (ctx) => {
          const d = discover(ctx, ownerTools(ctx.rng));
          const [v1, v2] = d.ids as [string, string];
          const store = d.build({
            owner: {
              impossible: [
                pairOf([v1, lex('alpha')], [v2, lex('north')]),
                pairOf([v2, lex('north')], [v1, lex('alpha')], 'Written the other way round.'),
              ],
            },
          });
          const hits = store.impossible.filter((p) => samePair(p, [v1, lex('alpha')], [v2, lex('north')]));
          must(hits.length === 1, () => `${hits.length} entries for one pair written in both orders`);
        },
      ],
      [
        'owner-pair-repeated-is-one-pair',
        3,
        (ctx) => {
          const d = discover(ctx, ownerTools(ctx.rng));
          const [v1, v2] = d.ids as [string, string];
          const same = pairOf([v1, lex('beta')], [v2, lex('south')]);
          const store = d.build({ owner: { impossible: [same, { ...same }, { ...same }] } });
          const hits = store.impossible.filter((p) => samePair(p, [v1, lex('beta')], [v2, lex('south')]));
          must(hits.length === 1, () => `${hits.length} entries for one pair written three times`);
        },
      ],
      [
        'owner-pair-with-a-missing-variable-is-refused',
        3,
        (ctx) => {
          const d = discover(ctx, ownerTools(ctx.rng));
          const [v1] = d.ids as [string, string];
          const store = d.build({
            owner: { impossible: [pairOf([v1, lex('alpha')], ['no_such_variable_here', lex('north')])] },
          });
          must(
            store.impossible.length === 0,
            () => `a pair that names a missing variable entered the store: ${show(store.impossible)}`,
          );
          must(store.refused.length >= 1, () => 'the pair that names a missing variable is not in refused');
          for (const r of store.refused)
            must(
              r.reason.length >= 8 && r.reason !== r.what,
              () => `refusal reason ${show(r.reason)} is too short or equals what`,
            );
        },
      ],
      [
        'owner-pair-with-a-missing-value-is-refused',
        3,
        (ctx) => {
          const d = discover(ctx, ownerTools(ctx.rng));
          const [v1, v2] = d.ids as [string, string];
          const store = d.build({
            owner: { impossible: [pairOf([v1, lex('alpha')], [v2, 'no_such_value_here'])] },
          });
          must(
            store.impossible.length === 0,
            () => `a pair that names a missing value entered the store: ${show(store.impossible)}`,
          );
          must(store.refused.length >= 1, () => 'the pair that names a missing value is not in refused');
        },
      ],
      [
        'owner-valid-pair-survives-a-refused-sibling',
        4,
        (ctx) => {
          const d = discover(ctx, ownerTools(ctx.rng));
          const [v1, v2] = d.ids as [string, string];
          const store = d.build({
            owner: {
              impossible: [
                pairOf([v1, lex('gamma')], [v2, lex('south')]),
                pairOf([v1, lex('alpha')], [v2, 'nowhere']),
              ],
            },
          });
          must(
            store.impossible.some((p) => samePair(p, [v1, lex('gamma')], [v2, lex('south')])),
            () => 'the valid pair is gone',
          );
          must(
            store.impossible.length === 1,
            () => `${store.impossible.length} pairs in the store; expected the valid one only`,
          );
          must(
            store.refused.length === 1,
            () => `${store.refused.length} refusals; expected one for the bad pair`,
          );
        },
      ],
      [
        'owner-pair-blank-words-refused',
        4,
        (ctx) => {
          const d = discover(ctx, ownerTools(ctx.rng));
          const [v1, v2] = d.ids as [string, string];
          const store = d.build({
            owner: { impossible: [pairOf([v1, lex('alpha')], [v2, lex('north')], '   ')] },
          });
          must(store.impossible.length === 0, () => 'a pair with blank owner words entered the store');
          must(store.refused.length >= 1, () => 'a pair with blank owner words is not in refused');
        },
      ],
      [
        'owner-pair-unreal-date-refused',
        4,
        (ctx) => {
          const d = discover(ctx, ownerTools(ctx.rng));
          const [v1, v2] = d.ids as [string, string];
          const store = d.build({
            owner: {
              impossible: [pairOf([v1, lex('alpha')], [v2, lex('north')], 'We know it.', '2026-02-30')],
            },
          });
          must(store.impossible.length === 0, () => 'a pair dated 2026-02-30 entered the store');
          must(store.refused.length >= 1, () => 'a pair with an unreal date is not in refused');
        },
      ],
    ],
  },
];

/** A space with no valid row: the plan gives no new rows, or throws an error that names the conflict. */
function unsat(ctx: ItemContext, arities: number[], kind: 'pairs' | 'singles' | 'cycle'): void {
  const ids = names(ctx.rng, arities.length) as string[];
  const vars = arities.map((a, i) => ({ id: ids[i] as string, values: valueIds(a), shared: true }));
  const forbids: Array<{ forbid: Row }> = [];
  if (kind === 'pairs') {
    for (const x of valueIds(arities[0] as number)) {
      for (const y of valueIds(arities[1] as number))
        forbids.push({ forbid: { [ids[0] as string]: x, [ids[1] as string]: y } });
    }
  } else if (kind === 'singles') {
    for (const x of valueIds(arities[0] as number)) forbids.push({ forbid: { [ids[0] as string]: x } });
  } else {
    // Three variables over two values that must all differ: no assignment exists.
    for (const [p, q] of [
      [0, 1],
      [1, 2],
      [0, 2],
    ] as const) {
      for (const x of ['v0', 'v1'])
        forbids.push({ forbid: { [ids[p] as string]: x, [ids[q] as string]: x } });
    }
  }
  const store = makeStore({ vars, forbids });
  must(
    allRows(spaceOf(store)).length === 0,
    () => 'the bank built a satisfiable space for an unsatisfiable item',
  );
  let plan: ReturnType<typeof callPlan> | undefined;
  const run = need(ctx, 'plan');
  try {
    plan = run(store, { seed: ctx.seed }) as ReturnType<typeof callPlan>;
  } catch (error) {
    const message = (error as Error).message;
    must(message.length > 0, () => 'the plan threw an error with no message');
    must(
      ids.some((id) => message.includes(id)),
      () => `the error "${message}" names none of the variables in conflict: ${ids.join(', ')}`,
    );
    return;
  }
  must(
    newRows(plan).length === 0,
    () => `an unsatisfiable space gave ${newRows(plan as NonNullable<typeof plan>).length} new rows`,
  );
}
