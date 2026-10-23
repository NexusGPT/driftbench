import { check } from '../../../../failure';
import type { Plan, PlanOptions, Row, StoreDoc } from '../../interface';
import { RARE_ROWS_CUT } from '../constants';
import { type ItemContext, planError, planOf, type StemRun } from '../item';
import { groupsOf, indexRow, logWeight, makeSpace, type Space, SpaceOracle, toStore } from '../oracle/space';
import { checkPlan, planIsSound, randomSeeds, randomSpace } from '../oracle/spaces';
import { must, show, stableStringify } from '../util';

/** Spaces with skewed shares whose unbudgeted plan has dozens of rows. */
function skewedSpace(ctx: ItemContext, vars = 9): Space {
  return randomSpace(ctx.rng, { vars, minArity: 2, maxArity: 3, shared: 4, rules: [3, 3], weights: true });
}

/** The page writes a log weight to nine places (docs/variables.md R9): half a unit of the ninth, with room for rounding twice. */
export const LOG_TOLERANCE = 1.1e-9;

const rowKey = (r: Plan['rows'][number]) => stableStringify({ id: r.id, kind: r.kind, values: r.values });

function samePrefix(full: Plan, budgeted: Plan, b: number, label: string): void {
  const want = full.rows.slice(0, Math.min(b, full.rows.length)).map(rowKey);
  const got = budgeted.rows.map(rowKey);
  check(got.length === want.length, () => ({
    rule: 'a budget keeps a prefix of the plan, counting the seeds',
    input: { label, budget: b },
    got: { rows: got.length },
    expected: { rows: want.length, uncut: full.rows.length },
  }));
  for (let i = 0; i < want.length; i += 1) {
    check(got[i] === want[i], () => ({
      rule: 'a budget keeps a prefix of the plan without a budget',
      input: { label, budget: b, row: i },
      got: { row: got[i]?.slice(0, 120) },
      expected: { row: want[i]?.slice(0, 120) },
    }));
  }
}

/** The log weights of the rows after the seeds, from the shares of the space. */
function freshLogs(space: Space, plan: Plan, seedCount: number): number[] {
  return plan.rows.slice(seedCount).map((r) => logWeight(space, indexRow(space, r.values)));
}

/** Along the plan the log weights must not move against the cut order (most common first when the rarest rows are cut first). */
function ordered(logs: readonly number[], label: string): void {
  for (let i = 1; i < logs.length; i += 1) {
    const prev = logs[i - 1] as number;
    const cur = logs[i] as number;
    const bad = RARE_ROWS_CUT === 'last' ? cur < prev - 1e-9 : cur > prev + 1e-9;
    check(!bad, () => ({
      rule: 'the new rows run in the order of their log weights that the page names',
      input: label,
      got: {
        row: i,
        logWeight: Number(cur.toFixed(4)),
        previousRow: i - 1,
        previousLogWeight: Number(prev.toFixed(4)),
      },
      expected: RARE_ROWS_CUT === 'last' ? 'rarest first' : 'most common first',
    }));
  }
}

const store = (space: Space, provenance?: 'owner' | 'conversations') =>
  toStore(space, provenance ? { weightProvenance: provenance } : {});

export const BUDGET_RUNS: Record<string, StemRun> = {
  'budget.prefix-of-full-plan': (variant, ctx) => {
    const { rng } = ctx;
    const space = skewedSpace(ctx);
    const oracle = new SpaceOracle(space);
    const seeds: Row[] = ['with-seeds', 'seeds-plus-budget-length'].includes(variant)
      ? randomSeeds(space, oracle, rng, 3)
      : [];
    const st = store(space);
    const run = (budget?: number): Plan =>
      planOf(ctx, st, {
        seed: ctx.seed,
        ...(budget !== undefined ? { budget } : {}),
        ...(seeds.length ? { seeds: seeds.map((s) => ({ ...s })) } : {}),
      });
    const full = run();
    const total = full.rows.length;
    check(total >= seeds.length + 6, () => ({
      rule: 'the plan without a budget has only {} rows; the item needs a larger plan',
      got: { details: [total] },
    }));
    const label = `${variant} (plan of ${total} rows, ${seeds.length} seeds)`;
    switch (variant) {
      case 'middle':
        samePrefix(full, run(Math.floor(total / 2)), Math.floor(total / 2), label);
        break;
      case 'one-row':
        samePrefix(full, run(1), 1, label);
        break;
      case 'all-but-one':
        samePrefix(full, run(total - 1), total - 1, label);
        break;
      case 'with-seeds': {
        const b = seeds.length + Math.floor((total - seeds.length) / 2);
        samePrefix(full, run(b), b, label);
        break;
      }
      case 'above-total':
        samePrefix(full, run(total + 5), total + 5, label);
        break;
      case 'three-budgets-nested': {
        for (const b of [Math.floor(total / 4), Math.floor(total / 2), Math.floor((3 * total) / 4)])
          samePrefix(full, run(b), b, label);
        break;
      }
      case 'every-budget-nested':
        for (let b = 0; b <= total + 2; b += 1) samePrefix(full, run(b), b, label);
        break;
      case 'every-budget-length':
        for (let b = 0; b <= total + 2; b += 1) {
          const got = run(b).rows.length;
          check(got === Math.min(b, total), () => ({
            rule: 'a budget gives as many rows as the budget, or the whole plan',
            input: { label, budget: b, plan: total },
            got: { rows: got },
            expected: { rows: Math.min(b, total) },
          }));
        }
        break;
      case 'seeds-plus-budget-length':
        for (let b = seeds.length; b <= total + 2; b += 1) {
          const plan = run(b);
          check(plan.rows.length === Math.min(b, total), () => ({
            rule: 'a budget gives as many rows as the budget, or the whole plan',
            input: { label, budget: b, plan: total },
            got: { rows: plan.rows.length },
            expected: { rows: Math.min(b, total) },
          }));
          check(
            plan.rows.slice(0, seeds.length).every((r) => r.kind === 'seed'),
            () => ({
              rule: '{}: with budget {} the seeds do not lead the plan',
              got: { details: [label, b] },
            }),
          );
        }
        break;
      default: {
        const empty = planOf(ctx, st, { seed: ctx.seed, budget: 0 });
        check(empty.rows.length === 0, () => ({
          rule: 'a budget of 0 with no seeds gives an empty plan',
          got: { rows: empty.rows.length },
        }));
      }
    }
  },

  'budget.new-rows-common-first': (variant, ctx) => {
    const { rng } = ctx;
    const space =
      variant === 'four-variables'
        ? randomSpace(rng, { vars: 4, minArity: 2, maxArity: 3, rules: [4], weights: true })
        : variant === 'ten-variables'
          ? randomSpace(rng, { vars: 10, minArity: 2, maxArity: 3, shared: 4, rules: [3, 3], weights: true })
          : variant === 'equal-shares-ties'
            ? (() => {
                const s = skewedSpace(ctx);
                for (const v of s.vars) v.weights = v.values.map(() => 1 / v.values.length);
                return s;
              })()
            : skewedSpace(ctx);
    const oracle = new SpaceOracle(space);
    const seeds = variant === 'cut-with-seeds' ? randomSeeds(space, oracle, rng, 3) : [];
    const st = store(space);
    const base: PlanOptions = { seed: ctx.seed, ...(seeds.length ? { seeds } : {}) };
    const full = planOf(ctx, st, base);
    const facts = checkPlan(space, oracle, full, { seeds });
    check(facts.problems.length === 0, () => ({
      rule: 'the plan is sound and covers every allowed required tuple within the row bound of the page',
      got: { problems: facts.problems },
      expected: facts.hidden,
    }));
    const total = full.rows.length;
    ordered(freshLogs(space, full, seeds.length), `${total} rows`);
    if (variant.startsWith('cut-')) {
      const budget =
        variant === 'cut-tight-budget'
          ? Math.max(1, Math.floor(total / 10)) + seeds.length
          : variant === 'cut-half-budget'
            ? Math.floor(total / 2)
            : seeds.length + Math.floor((total - seeds.length) / 3);
      const cut = planOf(ctx, st, { ...base, budget });
      const kept = freshLogs(space, cut, seeds.length);
      const dropped = full.rows.slice(budget).map((r) => logWeight(space, indexRow(space, r.values)));
      check(kept.length > 0 && dropped.length > 0, () => ({
        rule: 'budget {} of {} rows keeps {} and drops {} new rows',
        got: { details: [budget, total, kept.length, dropped.length] },
      }));
      if (RARE_ROWS_CUT === 'last') {
        const keptMax = Math.max(...kept);
        const droppedMin = Math.min(...dropped);
        check(droppedMin >= keptMax - 1e-9, () => ({
          rule: 'a budget cuts the new rows in the order of their weights that the page names',
          input: { budget },
          got: { droppedLogWeight: Number(droppedMin.toFixed(4)), keptLogWeight: Number(keptMax.toFixed(4)) },
          expected: 'the rare rows are cut last',
        }));
      } else {
        const keptMin = Math.min(...kept);
        const droppedMax = Math.max(...dropped);
        check(droppedMax <= keptMin + 1e-9, () => ({
          rule: 'a budget cuts the new rows in the order of their weights that the page names',
          input: { budget },
          got: { droppedLogWeight: Number(droppedMax.toFixed(4)), keptLogWeight: Number(keptMin.toFixed(4)) },
          expected: 'the rare rows are cut first',
        }));
      }
    }
  },

  'budget.invalid-values': (variant, ctx) => {
    const space = makeSpace([2, 2, 2], { shared: [0, 1, 2] });
    const bad: unknown =
      variant === 'negative' ? -1 : variant === 'nan' ? Number.NaN : variant === 'fraction' ? 1.5 : '10';
    const error = planError(ctx, toStore(space), { seed: ctx.seed, budget: bad as number });
    check(!!error, () => ({
      rule: 'plan throws for a budget the page refuses',
      input: { budget: show(bad) },
      got: 'no error',
      expected: { error: 'RangeError naming the budget' },
    }));
    const e = error as Error;
    check(e.name === 'RangeError' || (variant === 'string' && e.name === 'TypeError'), () => ({
      rule: 'the error of a refused budget is a RangeError',
      got: { name: e.name, message: e.message },
    }));
    check(e.message.toLowerCase().includes('budget'), () => ({
      rule: 'the error "{}" does not name the budget',
      got: { details: [e.message] },
    }));
  },

  'budget.log-space-weights': (variant, ctx) => {
    const n = variant === 'two-hundred-variables' ? 200 : 100;
    const share = variant === 'two-hundred-variables' ? 1e-4 : 1e-6;
    const space = makeSpace(Array(n).fill(2), { shared: Array.from({ length: n }, (_, i) => i) });
    for (const v of space.vars) v.weights = [share, 1 - share];
    const plan = planOf(ctx, toStore(space), { seed: ctx.seed });
    const facts = checkPlan(space, new SpaceOracle(space), plan, { noCoverage: true });
    planIsSound(facts);
    ordered(freshLogs(space, plan, 0), `${n} variables with shares ${share}`);
    const distinct = new Set(freshLogs(space, plan, 0).map((x) => x.toFixed(3))).size;
    check(distinct >= 2, () => ({ rule: 'the generator should give rows of different weights' }));
  },

  'budget.weights-from-store': (variant, ctx) => {
    const space = skewedSpace(ctx);
    const plan = planOf(ctx, store(space, variant === 'owner-declared' ? 'owner' : 'conversations'), {
      seed: ctx.seed,
    });
    ordered(freshLogs(space, plan, 0), `weights from ${variant}`);
    const logs = freshLogs(space, plan, 0);
    check(new Set(logs.map((x) => x.toFixed(6))).size > 1, () => ({
      rule: 'the generator should give rows of different weights',
    }));
  },

  'budget.uniform-without-weights': (variant, ctx) => {
    const { rng } = ctx;
    const space = skewedSpace(ctx);
    if (variant === 'no-weights') {
      for (const v of space.vars) delete v.weights;
    } else {
      space.vars.forEach((v, i) => {
        if (i % 2 === 1) delete v.weights;
      });
    }
    const st = store(space);
    const full = planOf(ctx, st, { seed: ctx.seed });
    const facts = checkPlan(space, new SpaceOracle(space), full);
    planIsSound(facts);
    const total = full.rows.length;
    const b = Math.max(1, Math.floor(total / 2));
    samePrefix(full, planOf(ctx, st, { seed: ctx.seed, budget: b }), b, variant);
    if (variant === 'no-weights') {
      const w0 = full.rows[0]?.logWeight as number;
      check(
        full.rows.every(
          (r) => typeof r.logWeight === 'number' && Math.abs(r.logWeight - w0) <= LOG_TOLERANCE,
        ),
        () => ({
          rule: 'no variable has weights but the rows report different log weights: {}',
          got: { details: [show(full.rows.slice(0, 4).map((r) => r.logWeight))] },
        }),
      );
    } else {
      ordered(freshLogs(space, full, 0), 'partial weights (a variable without weights counts as uniform)');
    }
    void rng;
  },

  'budget.weight-reported': (variant, ctx) => {
    const { rng } = ctx;
    const space =
      variant === 'short-rows'
        ? randomSpace(rng, { vars: 4, minArity: 3, maxArity: 3, rules: [4], weights: true })
        : randomSpace(rng, { vars: 6, minArity: 2, maxArity: 4, shared: 3, rules: [3], weights: true });
    const plan = planOf(ctx, toStore(space), { seed: ctx.seed });
    const facts = checkPlan(space, new SpaceOracle(space), plan);
    planIsSound(facts);
    let previous = Number.POSITIVE_INFINITY;
    for (const [i, r] of plan.rows.entries()) {
      const want = logWeight(space, indexRow(space, r.values));
      check(typeof r.logWeight === 'number' && Math.abs(r.logWeight - want) <= LOG_TOLERANCE, () => ({
        rule: 'logWeight is the sum of the logs of the shares of the values of the row',
        input: { row: i },
        got: { logWeight: r.logWeight },
        expected: want,
      }));
      check((r.logWeight as number) <= previous + LOG_TOLERANCE, () => ({
        rule: 'the reported weights do not rise along the plan',
        input: { row: i },
        got: { logWeight: r.logWeight, previous },
      }));
      previous = r.logWeight as number;
    }
    void groupsOf;
  },
};

void (undefined as unknown as StoreDoc);
