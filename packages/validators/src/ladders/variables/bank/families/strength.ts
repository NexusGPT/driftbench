import { check } from '../../../../failure';
import type { Plan } from '../../interface';
import { type StemRun, tryPlan } from '../item';
import { groupsOf, indexRow, makeSpace, type Space, SpaceOracle, toStore } from '../oracle/space';
import {
  checkPlan,
  describeSpace,
  planAndCheck,
  planIsSound,
  randomSeeds,
  randomSpace,
} from '../oracle/spaces';
import { must, show } from '../util';
import { toBig } from './counter';

const BOUND = 1.25;

/** All variables are rule variables: a single rule over them. */
function ruleSpace(arities: number[]): Space {
  return makeSpace(arities, { rules: [arities.map((_, i) => i)] });
}

function fullProduct(space: Space): number {
  return space.vars.reduce((p, v) => p * v.values.length, 1);
}

export const STRENGTH_RUNS: Record<string, StemRun> = {
  'strength.others-at-one': (variant, ctx) => {
    const { rng } = ctx;
    const arities =
      variant === 'three-variables'
        ? [2, 2, 2]
        : variant === 'single-variable'
          ? [4]
          : variant === 'arity-one'
            ? [1, 3]
            : Array.from({ length: 10 }, () => rng.int(2, 5));
    planAndCheck(ctx, makeSpace(arities), { boundFactor: BOUND });
  },

  'strength.others-economy': (variant, ctx) => {
    const space = makeSpace(Array(variant === 'thirty-variables' ? 30 : 100).fill(5));
    const facts = planAndCheck(ctx, space);
    check(facts.fresh.length <= 10, () => ({
      rule: 'strength 1 on a variable needs about its arity in rows, not a pairwise array',
      input: { space: describeSpace(space) },
      got: { rows: facts.fresh.length },
      expected: { atMost: 10 },
    }));
  },

  'strength.axes-at-two': (variant, ctx) => {
    const { rng } = ctx;
    const arities =
      variant === 'three-axes'
        ? [2, 3, 4]
        : variant === 'six-axes'
          ? Array.from({ length: 6 }, () => rng.int(2, 3))
          : variant === 'six-axes-one-single-valued'
            ? [2, 3, 1, 3, 2, 3]
            : variant === 'twelve-binary'
              ? Array(12).fill(2)
              : variant === 'one-axis-of-seven'
                ? [7, 2, 2, 2]
                : variant === 'one-axis-of-one'
                  ? [1, 2, 2, 2]
                  : [20, 2, 2, 2];
    planAndCheck(ctx, makeSpace(arities, { shared: arities.map((_, i) => i) }), { boundFactor: BOUND });
  },

  'strength.rule-at-three': (variant, ctx) => {
    const { rng } = ctx;
    const arities =
      variant === 'three-variables'
        ? [rng.int(2, 3), rng.int(2, 3), rng.int(2, 3)]
        : variant === 'four-binary'
          ? Array(4).fill(2)
          : variant === 'five-ternary'
            ? Array(5).fill(3)
            : variant === 'seven-binary'
              ? Array(7).fill(2)
              : variant === 'mixed-arity'
                ? [2, 3, 4, 5]
                : variant === 'four-quaternary'
                  ? Array(4).fill(4)
                  : Array(12).fill(2);
    planAndCheck(ctx, ruleSpace(arities), { boundFactor: BOUND });
  },

  'strength.small-groups': (variant, ctx) => {
    const space =
      variant === 'two-variables'
        ? makeSpace([3, 4, 2], { rules: [[0, 1]] })
        : variant === 'one-variable'
          ? makeSpace([5, 2], { rules: [[0]] })
          : makeSpace([3, 3, 2], { rules: [[]] });
    const facts = planAndCheck(ctx, space, { boundFactor: BOUND });
    if (variant === 'two-variables') {
      const oracle = new SpaceOracle(space);
      const got = oracle.covered(facts.fresh, groupsOf(space)).size;
      check(got >= 12 + 2, () => ({
        rule: 'a rule over two variables is crossed in full',
        got: { requiredTuplesCovered: got },
        expected: { atLeast: 14 },
      }));
    }
  },

  'strength.overlapping-rules': (variant, ctx) => {
    const space =
      variant === 'share-two'
        ? makeSpace(Array(6).fill(3), {
            rules: [
              [0, 1, 2, 3],
              [2, 3, 4, 5],
            ],
          })
        : makeSpace(Array(5).fill(3), {
            rules: [
              [0, 1, 2, 3],
              [1, 2, 3, 4],
            ],
          });
    planAndCheck(ctx, space, { boundFactor: BOUND });
  },

  'strength.axis-in-rule': (variant, ctx) => {
    const space =
      variant === 'one-shared'
        ? makeSpace([3, 3, 3, 3, 3], { shared: [0, 1, 2], rules: [[2, 3, 4]] })
        : makeSpace([3, 3, 3, 3, 2], { shared: [0, 1, 2, 3], rules: [[0, 1, 2]] });
    planAndCheck(ctx, space, { boundFactor: BOUND });
  },

  'strength.no-uniform-explosion': (variant, ctx) => {
    // Big arities outside the rules: strength 3 or 2 across all variables would need at least 6^3 or 6^2 rows.
    let space: Space;
    if (variant === 'ten-rules') {
      const rules = Array.from({ length: 10 }, (_, k) => [3 * k, 3 * k + 1, 3 * k + 2]);
      space = makeSpace([...Array(30).fill(2), ...Array(10).fill(6), ...Array(4).fill(2)], {
        rules,
        shared: [40, 41, 42, 43],
      });
    } else if (variant === 'mixed-groups') {
      const rules = Array.from({ length: 5 }, (_, k) => [4 * k, 4 * k + 1, 4 * k + 2, 4 * k + 3]);
      space = makeSpace([...Array(20).fill(2), ...Array(6).fill(3), ...Array(20).fill(5)], {
        rules,
        shared: [20, 21, 22, 23, 24, 25],
      });
    } else {
      const rules = Array.from({ length: 40 }, (_, k) => [3 * k, 3 * k + 1, 3 * k + 2]);
      space = makeSpace([...Array(120).fill(2), ...Array(5).fill(6)], { rules });
    }
    const facts = planAndCheck(ctx, space, { boundFactor: BOUND });
    check(facts.fresh.length < 100, () => ({
      rule: 'strength 3 across variables is covered by fewer rows than the full product',
      input: { space: describeSpace(space) },
      got: { rows: facts.fresh.length },
      expected: { fewerThan: 100 },
    }));
  },

  'strength.row-economy': (variant, ctx) => {
    const arities =
      variant === 'six-binary'
        ? Array(6).fill(2)
        : variant === 'five-ternary'
          ? Array(5).fill(3)
          : variant === 'four-quaternary'
            ? Array(4).fill(4)
            : Array(8).fill(2);
    const space = ruleSpace(arities);
    const facts = planAndCheck(ctx, space, { boundFactor: BOUND });
    const product = fullProduct(space);
    check(facts.fresh.length < 0.6 * product, () => ({
      rule: 'a covering array takes well under the full product in rows',
      input: { space: describeSpace(space), fullProduct: product },
      got: { rows: facts.fresh.length },
      expected: { fewerThan: Math.floor(0.6 * product) },
    }));
  },

  'strength.rows-complete-and-valid': (variant, ctx) => {
    const { rng } = ctx;
    const space =
      variant === 'small'
        ? makeSpace([2, 3, 2])
        : variant === 'rules-and-axes'
          ? randomSpace(rng, { vars: 7, minArity: 2, maxArity: 3, shared: 2, rules: [3] })
          : randomSpace(rng, { vars: 8, minArity: 1, maxArity: 6, shared: 3, rules: [3, 3], overlap: true });
    const facts = planAndCheck(ctx, space, { noCoverage: true });
    check(facts.fresh.length >= 1, () => ({ rule: 'the plan has no new row' }));
  },

  'strength.report-matches-counter': (variant, ctx) => {
    const { rng } = ctx;
    const space =
      variant === 'axes'
        ? randomSpace(rng, { vars: 5, minArity: 2, maxArity: 3, shared: 5 })
        : variant === 'rules'
          ? randomSpace(rng, { vars: 6, minArity: 2, maxArity: 3, rules: [3, 3] })
          : randomSpace(rng, { vars: 7, minArity: 2, maxArity: 3, shared: 2, rules: [3], density: 0.2 });
    const oracle = new SpaceOracle(space);
    const groups = groupsOf(space);
    const seeds = variant === 'mixed' ? randomSeeds(space, oracle, rng, 3) : [];
    const store = toStore(space);
    const { plan, error } = tryPlan(ctx, store, { seed: ctx.seed, ...(seeds.length ? { seeds } : {}) });
    check(!error, () => ({ rule: 'plan threw {}: {}', got: { details: [error?.name, error?.message] } }));
    const facts = checkPlan(space, oracle, plan as Plan, { seeds });
    planIsSound(facts);
    const report = (plan as Plan).report;
    check(!!report && report.allowed !== undefined && report.covered !== undefined, () => ({ rule: 'the plan has no report with allowed and covered: {}', got: { details: [show(report)] } }));
    const rows = [...seeds.map((s) => indexRow(space, s)), ...facts.fresh];
    const required = oracle.required(groups);
    const covered = oracle.covered(rows, groups, required);
    const r = report as NonNullable<Plan['report']>;
    check(toBig(r.allowed, 'report.allowed') === BigInt(required.size), () => ({
      rule: 'the report counts the allowed tuples exactly',
      got: { allowed: show(r.allowed) },
      expected: { allowed: required.size },
    }));
    check(toBig(r.covered, 'report.covered') === BigInt(covered.size), () => ({
      rule: 'the report counts the covered tuples exactly',
      got: { covered: show(r.covered) },
      expected: { covered: covered.size },
    }));
  },

  'strength.any-seed-integer': (variant, ctx) => {
    const { rng } = ctx;
    const space = randomSpace(rng, { vars: 7, minArity: 2, maxArity: 3, shared: 3, rules: [3] });
    const seeds =
      variant === 'zero' ? [0] : variant === 'negative' ? [-1, -123456789] : [2147483648, 9007199254740991];
    for (const seed of seeds) {
      const facts = planAndCheck(ctx, space, { seed, boundFactor: BOUND });
      check(facts.fresh.length >= 1, () => ({ rule: 'the plan has a new row', input: { seed } }));
    }
  },
};
