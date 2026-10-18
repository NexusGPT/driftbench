import type { Plan, PlanRow, Row, StoreDoc, StoreVariable } from '../../interface';
import { OWNER_DATE } from '../constants';
import { type ItemContext, planOf, type StemRun } from '../item';
import { GeneralOracle } from '../oracle/general';
import {
  forbid,
  groupsOf,
  indexRow,
  logWeight,
  makeSpace,
  rowOf,
  type Space,
  SpaceOracle,
  toStore,
} from '../oracle/space';
import { checkPlan, randomSeeds, randomSpace } from '../oracle/spaces';
import { clone, must, show, stableStringify } from '../util';
import { LOG_TOLERANCE } from './budget';

/**
 * Plan stems that came from the second variables bank (PR 762) and that the first one lacked: what a plan does
 * with a budget below its seed count, with seeds that name things the store does not have, with a weight of 0 and
 * with a combination that is not a pair (docs/variables.md R6 to R9). Each stem uses the same independent
 * small-space oracles as the rest of the bank.
 */

const warningCodes = (plan: Plan): string[] => (plan.warnings ?? []).map((w) => w.code);

function needWarning(plan: Plan, code: string, why: string): void {
  must(
    warningCodes(plan).includes(code),
    () => `the plan has no warning ${code} (${why}); its warnings are ${show(warningCodes(plan))}`,
  );
}

function midSpace(ctx: ItemContext, forbidden = false): Space {
  return randomSpace(ctx.rng, {
    vars: 6,
    minArity: 2,
    maxArity: 3,
    shared: 2,
    rules: [3],
    density: forbidden ? 0.25 : 0,
  });
}

export const PLAN_RUNS: Record<string, StemRun> = {
  'budget.below-seed-count': (variant, ctx) => {
    const space = midSpace(ctx);
    const oracle = new SpaceOracle(space);
    const seeds = randomSeeds(space, oracle, ctx.rng, 4);
    const budget =
      variant === 'zero-with-seeds' ? 0 : variant === 'one-below' ? seeds.length - 1 : seeds.length;
    const plan = planOf(ctx, toStore(space), { seed: ctx.seed, budget, seeds: clone(seeds) });
    must(
      plan.rows.length === seeds.length,
      () =>
        `budget ${budget} with ${seeds.length} seeds gives ${plan.rows.length} rows; a budget below the seed count keeps every seed and no new row`,
    );
    plan.rows.forEach((row, i) => {
      must(
        row.kind === 'seed' && stableStringify(row.values) === stableStringify(seeds[i]),
        () => `row ${i} is not seed ${i} as given: ${show(row, 140)}`,
      );
    });
  },

  'seeds.kept-with-warnings': (variant, ctx) => {
    const { rng } = ctx;
    if (variant === 'nothing-approved') {
      const space = midSpace(ctx);
      const oracle = new SpaceOracle(space);
      const seeds = randomSeeds(space, oracle, rng, 3);
      const store = toStore(space);
      for (const v of store.variables) v.approved = false;
      const plan = planOf(ctx, store, { seed: ctx.seed, seeds: clone(seeds) });
      must(
        plan.rows.length === seeds.length &&
          plan.rows.every(
            (r, i) => r.kind === 'seed' && stableStringify(r.values) === stableStringify(seeds[i]),
          ),
        () =>
          `when nothing is approved the plan is the seeds alone, kept whole: ${show(plan.rows.length)} rows`,
      );
      needWarning(plan, 'no_variables', 'nothing in the store is approved');
      return;
    }
    const withPairs = variant === 'forbidden-seed';
    const space = midSpace(ctx, withPairs);
    if (withPairs && space.forbidden.length === 0) forbid(space, 2, 1, 3, 1);
    const oracle = new SpaceOracle(space);
    const store = toStore(space);
    const base = randomSeeds(space, oracle, rng, 2);
    let seeds: Row[];
    let effective: Row[];
    let code: string;
    if (variant === 'unknown-variable' || variant === 'unknown-value') {
      const entry: [string, string] =
        variant === 'unknown-variable'
          ? [`ghost_${ctx.seed}`, 'x0']
          : [space.vars[1]?.id as string, `ghost_${ctx.seed}`];
      seeds = base.map((s, i) => (i === 0 ? { ...s, [entry[0]]: entry[1] } : { ...s }));
      // An unknown entry is dropped from its seed; the rest of the seed stays.
      effective = base.map((s, i) => {
        const copy = { ...s };
        if (i === 0 && variant === 'unknown-value') delete copy[entry[0]];
        return copy;
      });
      code = 'seed_unknown_value';
    } else if (variant === 'forbidden-seed') {
      const [a, va, b, vb] = space.forbidden[0] as readonly [number, number, number, number];
      const row = space.vars.map(() => 0);
      row[a] = va;
      row[b] = vb;
      seeds = [rowOf(space, row), ...base.slice(0, 1)];
      effective = seeds;
      code = 'seed_forbidden';
    } else {
      // unapproved-value: a value the store has and nobody approved. The seed is kept whole.
      const decoy: StoreVariable = {
        id: `decoy_${ctx.seed}`,
        approved: false,
        values: [
          { id: 'd0', provenance: [{ kind: 'owner', words: 'a proposal', date: OWNER_DATE }] },
          { id: 'd1', provenance: [{ kind: 'owner', words: 'a proposal', date: OWNER_DATE }] },
        ],
      };
      store.variables.push(decoy);
      seeds = base.map((s, i) => (i === 0 ? { ...s, [decoy.id]: 'd1' } : { ...s }));
      effective = base;
      code = 'seed_unapproved_value';
    }
    const plan = planOf(ctx, store, { seed: ctx.seed, seeds: clone(seeds) });
    needWarning(plan, code, variant.replace(/-/g, ' '));
    const kept = plan.rows.slice(0, seeds.length);
    // What each seed row must hold: the unknown entries are gone, the unapproved and forbidden ones stay.
    const want = variant === 'unapproved-value' || variant === 'forbidden-seed' ? seeds : effective;
    kept.forEach((row, i) => {
      must(
        row.kind === 'seed' && stableStringify(row.values) === stableStringify(want[i]),
        () => `seed row ${i} is ${show(row.values, 160)}; the page keeps ${show(want[i], 160)}`,
      );
    });
    // The rest of the plan covers what the seeds do not, judged on the entries the space knows.
    const known: PlanRow[] = plan.rows.map((row) => ({
      ...row,
      values: Object.fromEntries(
        Object.entries(row.values).filter(([k]) => space.vars.some((v) => v.id === k)),
      ),
    }));
    const facts = checkPlan(
      space,
      oracle,
      { ...plan, rows: known },
      {
        seeds: want.map((w) =>
          Object.fromEntries(Object.entries(w).filter(([k]) => space.vars.some((v) => v.id === k))),
        ),
      },
    );
    // A forbidden seed holds an impossible pair on purpose; only the new rows are held to the pairs.
    must(facts.problems.length === 0, () => facts.problems.join('; '));
  },

  'weights.plan-shares': (variant, ctx) => {
    const { rng } = ctx;
    const space = randomSpace(rng, {
      vars: 6,
      minArity: 2,
      maxArity: 3,
      shared: 3,
      rules: [3],
      weights: true,
    });
    if (variant === 'zero-share') {
      const v = space.vars[rng.int(0, 5)];
      if (!v) throw new Error('no variable');
      const rest = (v.weights as number[]).slice(1);
      const total = rest.reduce((a, b) => a + b, 0);
      v.weights = [0, ...rest.map((w) => w / total)];
    }
    const store = toStore(space);
    const plan = planOf(ctx, store, { seed: ctx.seed });
    const oracle = new SpaceOracle(space);
    const facts = checkPlan(space, oracle, plan);
    must(facts.problems.length === 0, () => facts.problems.join('; '));
    if (variant === 'scale-invariant') {
      const scaled = clone(store);
      for (const variable of scaled.variables)
        for (const value of variable.values) if (value.weight !== undefined) value.weight *= 100;
      const other = planOf(ctx, scaled, { seed: ctx.seed });
      must(other.rows.length === plan.rows.length, 'scaling every weight by 100 changed the number of rows');
      plan.rows.forEach((row, i) => {
        const twin = other.rows[i] as PlanRow;
        const same =
          row.id === twin.id &&
          stableStringify(row.values) === stableStringify(twin.values) &&
          typeof row.logWeight === 'number' &&
          typeof twin.logWeight === 'number' &&
          Math.abs(row.logWeight - twin.logWeight) <= LOG_TOLERANCE;
        must(
          same,
          () =>
            `weights are relative, yet scaling them by 100 changed row ${i}: ${show(row)} then ${show(twin)}`,
        );
      });
      return;
    }
    // zero-share: a row with a value of weight 0 reports minus infinity as null and runs after every finite row.
    let seenNull = false;
    for (const [i, row] of plan.rows.entries()) {
      const want = logWeight(space, indexRow(space, row.values));
      if (want === Number.NEGATIVE_INFINITY) {
        must(
          row.logWeight === null,
          () => `row ${i} holds a value of weight 0 and reports logWeight ${show(row.logWeight)}, not null`,
        );
        seenNull = true;
      } else {
        must(!seenNull, () => `row ${i} has a finite weight but comes after a row of weight 0`);
        must(
          typeof row.logWeight === 'number' && Math.abs(row.logWeight - want) <= LOG_TOLERANCE,
          () =>
            `row ${i} reports logWeight ${show(row.logWeight)}; the sum of the logs of its shares is ${want}`,
        );
      }
    }
    must(seenNull, 'the plan has no row with a value of weight 0; the value still needs its tuples covered');
    const text = JSON.stringify(plan.rows.map((r) => r.logWeight));
    must(!/Infinity|NaN/.test(text), 'a logWeight of minus infinity must be written as null');
  },

  'impossible.general-forbid': (variant, ctx) => {
    const { rng } = ctx;
    const space = makeSpace([3, 3, 3, 3, 3], { shared: [0, 1], rules: [[2, 3, 4]] });
    // Forbids are lists of (variable, value) cells, any size; value 0 of every variable is never in one.
    let forbids: Array<Array<[number, number]>>;
    const target = variant === 'detail-named' ? 4 : rng.int(0, 4);
    switch (variant) {
      case 'single-value':
        forbids = [[[target, 1]]];
        break;
      case 'triple':
        forbids = [
          [
            [2, 1],
            [3, 1],
            [4, 1],
          ],
        ];
        break;
      case 'unapproved-ignored':
        forbids = [
          [
            [0, 1],
            [1, 1],
          ],
        ];
        break;
      default:
        // detail-named: the forbid names a variable that is no shared axis and no rule's, plus an axis.
        forbids = [
          [
            [1, 1],
            [4, 1],
          ],
        ];
    }
    const approved = variant !== 'unapproved-ignored';
    const store: StoreDoc = {
      ...toStore(space),
      forbids: forbids.map((cells) => ({
        forbid: Object.fromEntries(
          cells.map(([v, x]) => [space.vars[v]?.id as string, space.vars[v]?.values[x] as string]),
        ),
        approved,
        provenance: [{ kind: 'owner', words: 'a combination that never occurs', date: OWNER_DATE }],
      })),
    };
    const oracle = new GeneralOracle(space, approved ? forbids : []);
    const plan = planOf(ctx, store, { seed: ctx.seed });
    const problems = oracle.check(plan, groupsOf(space));
    must(problems.length === 0, () => `${variant}: ${problems.join('; ')}`);
    if (variant === 'single-value')
      needWarning(
        plan,
        'value_unreachable',
        'a value that a combination forbids on its own can be held by no row',
      );
  },
};
