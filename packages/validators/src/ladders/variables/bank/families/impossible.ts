import { check, none } from '../../../../failure';
import type { Plan } from '../../interface';
import { OWNER_DATE } from '../constants';
import { build, type ItemContext, type StemRun, tryPlan } from '../item';
import { refusalsMentioning } from '../oracle/estate';
import {
  forbid,
  forbidRandom,
  forbidSet,
  isForbidden,
  makeSpace,
  type Space,
  SpaceOracle,
  toStore,
} from '../oracle/space';
import {
  checkPlan,
  planAndCheck,
  planIsSound,
  randomSeeds,
  randomSpace,
  randomValidRow,
} from '../oracle/spaces';
import { must, type Rng, show, stableStringify } from '../util';
import { type Base, baseStore } from './sources';

/** Forbids `count` distinct pairs among the non-universal values of the given variables. */
function forbidAmong(space: Space, rng: Rng, vars: readonly number[], count: number): void {
  const taken = forbidSet(space);
  for (let tries = 0, added = 0; added < count && tries < 500; tries += 1) {
    const [a, b] = rng.sample(vars, 2) as [number, number];
    const va = rng.int(1, (space.vars[a]?.values.length ?? 2) - 1);
    const vb = rng.int(1, (space.vars[b]?.values.length ?? 2) - 1);
    if (isForbidden(taken, a, va, b, vb)) continue;
    forbid(space, a, va, b, vb);
    taken.add(a < b ? ((a * 4096 + va) * 65536 + b) * 4096 + vb : ((b * 4096 + vb) * 65536 + a) * 4096 + va);
    added += 1;
  }
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

function planStore(ctx: ItemContext, store: ReturnType<typeof toStore>, seed: number): Plan {
  const { plan, error } = tryPlan(ctx, store, { seed });
  check(!error, () => ({ rule: 'plan threw {}: {}', got: { details: [error?.name, error?.message] }, expected: none('observation') }));
  return plan as Plan;
}

/** Hand-built spaces with few valid rows: the search has to find them. */
function tightSpace(kind: string): Space {
  switch (kind) {
    case 'alternating-binary': {
      const s = makeSpace([2, 2, 2, 2, 2, 2, 2, 2], { rules: [[0, 1, 2, 3]], universal: false });
      for (let i = 0; i < 7; i += 1) for (const a of [0, 1]) forbid(s, i, a, i + 1, a);
      return s;
    }
    case 'no-equal-neighbours-ternary': {
      const s = makeSpace([3, 3, 3, 3, 3], { rules: [[0, 1, 2]], universal: false });
      for (let i = 0; i < 4; i += 1) for (const a of [0, 1, 2]) forbid(s, i, a, i + 1, a);
      return s;
    }
    case 'exactly-one-of': {
      const s = makeSpace([2, 2, 2, 2, 2, 2], { universal: false });
      for (let i = 0; i < 6; i += 1) for (let j = i + 1; j < 6; j += 1) forbid(s, i, 1, j, 1);
      return s;
    }
    case 'hub-one-partner': {
      const s = makeSpace([4, 3, 3, 3], { rules: [[0, 1, 2]], universal: false });
      for (let k = 1; k <= 3; k += 1)
        for (let n = 1; n <= 3; n += 1) for (let j = 0; j < 3; j += 1) if (j !== k - 1) forbid(s, 0, k, n, j);
      return s;
    }
    default: {
      // one-value-excludes-all-but-one
      const s = makeSpace([3, 3, 2, 2, 3], { universal: false });
      forbid(s, 0, 2, 1, 0);
      forbid(s, 0, 2, 1, 2);
      forbid(s, 0, 1, 1, 1);
      forbid(s, 0, 1, 1, 2);
      return s;
    }
  }
}

export const IMPOSSIBLE_RUNS: Record<string, StemRun> = {
  'impossible.rows-avoid-pairs': (variant, ctx) => {
    const { rng } = ctx;
    let space: Space;
    if (variant === 'two-variables') {
      space = makeSpace([3, 3]);
      forbid(space, 0, 1, 1, 1);
    } else if (variant === 'five-variables') {
      space = randomSpace(rng, { vars: 5, minArity: 2, maxArity: 4 });
      forbidAmong(space, rng, range(5), 1);
    } else if (variant === 'three-pairs') {
      space = randomSpace(rng, { vars: 6, minArity: 2, maxArity: 3 });
      forbidAmong(space, rng, range(6), 3);
    } else if (variant === 'pair-on-shared-axes') {
      space = makeSpace([3, 3, 3, 3], { shared: [0, 1, 2, 3] });
      forbidAmong(space, rng, range(4), 2);
    } else {
      space = makeSpace([3, 3, 3, 3, 3], { rules: [[0, 1, 2, 3]] });
      forbidAmong(space, rng, [0, 1, 2, 3], 2);
    }
    const facts = planAndCheck(ctx, space, { noCoverage: true });
    check(facts.fresh.length >= 1, () => ({ rule: 'the plan has no new row', expected: none('observation') }));
  },

  'impossible.required-tuples-skip-pairs': (variant, ctx) => {
    const { rng } = ctx;
    let space: Space;
    if (variant === 'inside-rule-group') {
      space = makeSpace([3, 3, 3, 3, 3, 3], { rules: [[0, 1, 2, 3]] });
      forbidAmong(space, rng, [0, 1, 2, 3], 2);
    } else if (variant === 'inside-axes') {
      space = makeSpace([3, 3, 3, 3, 2, 2], { shared: [0, 1, 2, 3] });
      forbidAmong(space, rng, [0, 1, 2, 3], 2);
    } else if (variant === 'across-groups') {
      space = makeSpace([3, 3, 3, 3, 3, 3], {
        rules: [
          [0, 1, 2],
          [3, 4, 5],
        ],
      });
      forbid(space, 1, 1, 4, 2);
      forbid(space, 0, 2, 3, 1);
    } else {
      const density =
        variant === 'dense-thirty-percent' ? 0.3 : variant === 'dense-fifty-percent' ? 0.5 : 0.7;
      space = randomSpace(rng, { vars: 5, minArity: 3, maxArity: 4, rules: [5] });
      forbidRandom(space, rng, density);
    }
    planAndCheck(ctx, space);
  },

  'impossible.unordered': (variant, ctx) => {
    const { rng } = ctx;
    const space = randomSpace(rng, { vars: 6, minArity: 3, maxArity: 3, shared: 3, rules: [3] });
    forbidAmong(space, rng, range(6), 4);
    const a = toStore(space);
    const b = toStore(space);
    b.impossible = b.impossible.map((p, i) =>
      variant === 'reversed' || i % 2 === 0 ? { ...p, a: p.b, b: p.a } : p,
    );
    const planA = planStore(ctx, a, ctx.seed);
    const planB = planStore(ctx, b, ctx.seed);
    const facts = checkPlan(space, new SpaceOracle(space), planA);
    planIsSound(facts);
    check(stableStringify(planA) === stableStringify(planB), () => ({
      rule: 'declaring the pairs the other way round changed the plan: an impossible pair is unordered', expected: none('observation')
    }));
  },

  'impossible.duplicates-count-once': (variant, ctx) => {
    const { rng } = ctx;
    const space = randomSpace(rng, { vars: 6, minArity: 3, maxArity: 3, shared: 3, rules: [3] });
    forbidAmong(space, rng, range(6), 3);
    const once = toStore(space);
    const many = toStore(space);
    many.impossible = many.impossible.flatMap((p) =>
      variant === 'thrice' ? [p, { ...p }, { ...p }] : [p, { ...p, a: p.b, b: p.a }],
    );
    const planOnce = planStore(ctx, once, ctx.seed);
    const planMany = planStore(ctx, many, ctx.seed);
    const facts = checkPlan(space, new SpaceOracle(space), planOnce);
    planIsSound(facts);
    check(stableStringify(planOnce) === stableStringify(planMany), () => ({
      rule: 'declaring a pair more than once changed the plan: repeated pairs count once', expected: none('observation')
    }));
  },

  'impossible.same-variable-pair': (variant, ctx) => {
    const { rng } = ctx;
    const space = randomSpace(rng, {
      vars: 5,
      minArity: 3,
      maxArity: 3,
      rules: variant === 'inside-rule' ? [3] : [],
      shared: 2,
    });
    const without = toStore(space);
    const withPair = toStore(space);
    const target = variant === 'inside-rule' ? ((space.rules[0]?.vars[0] as number) ?? 2) : 3;
    const v = withPair.variables[target]?.id as string;
    withPair.impossible.push({
      a: { variable: v, value: 'x1' },
      b: { variable: v, value: 'x2' },
      provenance: [{ kind: 'owner', words: 'one variable cannot hold two values', date: OWNER_DATE }],
    });
    const planA = planStore(ctx, withPair, ctx.seed);
    const planB = planStore(ctx, without, ctx.seed);
    const facts = checkPlan(space, new SpaceOracle(space), planA);
    planIsSound(facts);
    check(stableStringify(planA) === stableStringify(planB), () => ({
      rule: 'a pair of two values of one variable changed the plan', expected: none('observation')
    }));
  },

  'impossible.unknown-reference': (variant, ctx) => {
    const base: Base = baseStore(ctx, [3, 3]);
    const [A, B] = base.vars as [Base['vars'][number], Base['vars'][number]];
    const good = { variable: A.variable.id, value: A.ids[0] as string };
    const bad =
      variant === 'unknown-variable'
        ? { variable: 'nosuchvariable', value: 'x0' }
        : variant === 'unknown-value'
          ? { variable: B.variable.id, value: 'nosuchvalue' }
          : { variable: 'nosuchvariable', value: 'nosuchvalue' };
    const store = build(ctx, {
      estate: base.estate,
      owner: {
        impossible: [{ a: good, b: bad, date: OWNER_DATE, words: 'the owner says these never meet' }],
      },
    });
    check(store.impossible.length === 0, () => ({
      rule: 'a pair that names a variable or value the store lacks is refused',
      input: { pair: show(bad) },
      got: { kept: show(store.impossible) }, expected: none('observation')
    }));
    const named = refusalsMentioning(
      store,
      bad.variable === 'nosuchvariable' ? 'nosuchvariable' : 'nosuchvalue',
    );
    check(named.length >= 1, () => ({
      rule: 'the refusal list {} does not name {}',
      got: { details: [show(store.refused), show(bad)] }, expected: none('observation')
    }));
    check(
      named.every((r) => typeof r.reason === 'string' && r.reason.trim() !== ''),
      () => ({ rule: 'a refusal has no reason: {}', got: { details: [show(named)] }, expected: none('observation') }),
    );
  },

  'impossible.forced-out-value': (variant, ctx) => {
    let space: Space;
    if (variant === 'one-step') {
      space = makeSpace([2, 2, 3], { universal: false });
      forbid(space, 0, 1, 1, 0);
      forbid(space, 0, 1, 1, 1);
    } else if (variant === 'two-step-chain') {
      space = makeSpace([2, 2, 2, 3], { universal: false });
      forbid(space, 0, 1, 1, 0);
      forbid(space, 1, 1, 2, 0);
      forbid(space, 1, 1, 2, 1);
    } else {
      space = makeSpace([3, 3, 3, 3, 2], { rules: [[0, 1, 2, 3]], universal: false });
      for (let j = 0; j < 3; j += 1) forbid(space, 0, 2, 1, j);
    }
    planAndCheck(ctx, space);
  },

  'impossible.unsatisfiable-space': (variant, ctx) => {
    let space: Space;
    if (variant === 'two-single-valued') {
      space = makeSpace([1, 1, 2], { universal: false });
      forbid(space, 0, 0, 1, 0);
    } else {
      space = makeSpace([2, 2, 2], { universal: false });
      forbid(space, 0, 0, 1, 0);
      forbid(space, 0, 0, 1, 1);
      forbid(space, 0, 1, 2, 0);
      forbid(space, 0, 1, 2, 1);
    }
    const oracle = new SpaceOracle(space);
    check(oracle.validRows().length === 0, () => ({
      rule: 'the generator must build a space with no valid row', expected: none('observation')
    }));
    // Removing the contradiction must recover a useful covering plan.
    planAndCheck(ctx, { ...space, forbidden: [], universal: true });
    const { plan, error } = tryPlan(ctx, toStore(space), { seed: ctx.seed });
    if (error) {
      const names = space.vars.map((v) => v.id);
      check(
        names.some((n) => error.message.includes(n)),
        () => ({
          rule: 'plan threw {}: {}, which names none of the variables {}',
          got: { details: [error.name, show(error.message), show(names)] }, expected: none('observation')
        }),
      );
      return;
    }
    check((plan as Plan).rows.length === 0, () => ({ rule: 'a space with no valid row gets an empty plan', got: { rows: (plan as Plan).rows.length, first: show((plan as Plan).rows[0]?.values) }, expected: { rows: 0 } }));
  },

  'impossible.tight-chain': (variant, ctx) => {
    const space = tightSpace(variant);
    const oracle = new SpaceOracle(space);
    const valid = oracle.validRows().length;
    check(valid >= 2, () => ({ rule: 'the generator must build a space with valid rows', expected: none('observation') }));
    const facts = planAndCheck(ctx, space);
    check(facts.fresh.length <= 4 * valid + 8, () => ({ rule: 'the plan stays within the row bound of the page for the valid rows of the space', input: { validRows: valid }, got: { rows: facts.fresh.length }, expected: { atMost: 4 * valid + 8 } }));
  },

  'impossible.with-seeds': (variant, ctx) => {
    const { rng } = ctx;
    const space = randomSpace(rng, {
      vars: 6,
      minArity: 2,
      maxArity: 3,
      shared: 2,
      rules: [3],
      density: 0.3,
    });
    const oracle = new SpaceOracle(space);
    let seeds: ReturnType<typeof randomSeeds>;
    if (variant === 'valid-seeds') {
      seeds = randomSeeds(space, oracle, rng, 4);
    } else {
      const forbiddenValues = new Set(
        space.forbidden.flatMap(([a, va, b, vb]) => [`${a}:${va}`, `${b}:${vb}`]),
      );
      seeds = [];
      for (let tries = 0; seeds.length < 5 && tries < 400; tries += 1) {
        const row = randomValidRow(space, oracle, rng);
        if (row.some((v, i) => forbiddenValues.has(`${i}:${v}`))) {
          seeds.push(
            Object.fromEntries(
              row.map((v, i) => [space.vars[i]?.id as string, space.vars[i]?.values[v] as string]),
            ),
          );
        }
      }
      check(seeds.length >= 2, () => ({ rule: 'the generator found no valid row next to a forbidden pair', expected: none('observation') }));
    }
    planAndCheck(ctx, space, { seeds });
  },
};
