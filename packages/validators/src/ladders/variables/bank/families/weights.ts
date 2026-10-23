import { check, none } from '../../../../failure';
import type { ConversationInput, StoreDoc, StoreValue, StoreVariable } from '../../interface';
import { OWNER_DATE } from '../constants';
import { build, callInterval, type StemRun } from '../item';
import { refusalsMentioning, sessionRows, valueById, variableOf } from '../oracle/estate';
import {
  bandInsideProbability,
  coverageThreshold,
  drawCategorical,
  skewShares,
  targetMix,
  wilson,
  wilsonCoverage,
  wilsonWidth,
  Z95,
} from '../oracle/stats';
import { must, type Rng, show, subRng } from '../util';
import { type Base, baseStore, draw, evenMix } from './sources';

/** The store variable of a base after a build, and its values by the base's order. */
function after(store: StoreDoc, base: Base, index = 0): { variable: StoreVariable; values: StoreValue[] } {
  const bv = base.vars[index] as Base['vars'][number];
  const variable = variableOf(store, bv.variable.id);
  check(!!variable, () => ({
    rule: 'a variable the sessions name is in the store built with them',
    input: { variable: bv.variable.id },
    expected: none('observation'),
  }));
  const values = bv.ids.map((id) => valueById(variable as StoreVariable, id));
  for (const [k, v] of values.entries()) {
    check(!!v, () => ({
      rule: 'a value the sessions name is in the store built with them',
      input: { variable: bv.variable.id, value: bv.ids[k] },
      expected: none('observation'),
    }));
  }
  return { variable: variable as StoreVariable, values: values as StoreValue[] };
}

function weightOf(value: StoreValue, label: string): number {
  check(typeof value.weight === 'number', () => ({
    rule: 'a value of an observed variable carries a numeric weight',
    input: { label },
    got: { weight: value.weight },
    expected: none('observation'),
  }));
  return value.weight as number;
}

/** Sessions with exactly the given counts of each value, in a fixed order. */
function sessionsFromCounts(base: Base, counts: readonly number[], prefix = 'sess'): ConversationInput[] {
  const rows: Array<Record<string, string>> = [];
  const bv = base.vars[0] as Base['vars'][number];
  counts.forEach((c, k) => {
    for (let i = 0; i < c; i += 1) rows.push({ [bv.variable.id]: bv.ids[k] as string });
  });
  return sessionRows(rows, prefix);
}

/** Sessions drawn from a mix over the first variable of the base. */
function drawn(
  rng: Rng,
  base: Base,
  n: number,
  mix: readonly number[],
): { sessions: ConversationInput[]; counts: number[] } {
  const bv = base.vars[0] as Base['vars'][number];
  const picks = drawCategorical(rng, n, mix);
  const counts = new Array<number>(mix.length).fill(0);
  const rows = picks.map((k) => {
    counts[k] = (counts[k] as number) + 1;
    return { [bv.variable.id]: bv.ids[k] as string };
  });
  return { sessions: sessionRows(rows), counts };
}

/** The share of a value among the values of its variable: weights are relative (docs/variables.md "Values"). */
function shareOf(variable: StoreVariable, value: StoreValue, label: string): number {
  let total = 0;
  for (const v of variable.values) total += weightOf(v, `value ${v.id} of ${variable.id}`);
  check(total > 0, () => ({
    rule: 'the weights of a variable are not all N',
    input: { variable: variable.id },
    expected: none('observation'),
  }));
  return weightOf(value, label) / total;
}

/** The conversations entry of a value, or fails naming the value. */
function countsOf(value: StoreValue, label: string): { count: number; total: number } {
  const p = (value.provenance ?? []).find((x) => x.kind === 'conversations');
  check(!!p && p.kind === 'conversations', () => ({
    rule: 'a value seen in conversations carries conversations provenance',
    input: { label },
    got: { provenance: value.provenance },
    expected: none('observation'),
  }));
  const c = p as Extract<NonNullable<StoreValue['provenance']>[number], { kind: 'conversations' }>;
  return { count: c.count, total: c.total };
}

const COVERAGE: Record<string, { p: number; n: number; reps: number }> = {
  'half-n100': { p: 0.5, n: 100, reps: 500 },
  'half-n20': { p: 0.5, n: 20, reps: 500 },
  'tenth-n50': { p: 0.1, n: 50, reps: 500 },
  'two-percent-n100': { p: 0.02, n: 100, reps: 600 },
  'two-percent-n1000': { p: 0.02, n: 1000, reps: 400 },
  'half-percent-n500': { p: 0.005, n: 500, reps: 500 },
  'ninety-five-n40': { p: 0.95, n: 40, reps: 500 },
  'near-one-n300': { p: 0.998, n: 300, reps: 500 },
};

export const WEIGHTS_RUNS: Record<string, StemRun> = {
  'weights.relative-frequency': (variant, ctx) => {
    const { rng } = ctx;
    const shapes =
      variant === 'ten-variables'
        ? Array.from({ length: 10 }, () => 3)
        : variant === 'five-values-skewed'
          ? [5]
          : variant === 'thousand-sessions'
            ? [4]
            : [3];
    const base = baseStore(ctx, shapes);
    const mixes = base.vars.map((v) => skewShares(rng, v.ids.length));
    const n =
      variant === 'thousand-sessions'
        ? 1000
        : variant === 'ten-variables'
          ? 60
          : variant === 'five-values-skewed'
            ? 100
            : rng.int(30, 80);
    const { sessions, counts, observed } = draw(rng, base, n, mixes);
    const store = build(ctx, { estate: base.estate, conversations: sessions });
    base.vars.forEach((bv, i) => {
      const { variable, values } = after(store, base, i);
      values.forEach((value, k) => {
        const seen = (counts[i] as number[])[k] as number;
        const of = observed[i] as number;
        const share = shareOf(variable, value, `value ${bv.ids[k]} of ${bv.variable.id}`);
        const tol = 1 / (of + 2) + 1e-9;
        check(Math.abs(share - seen / of) <= tol, () => ({
          rule: "the share of a value in the variable's weight is about the share seen in the sessions",
          input: { value: bv.ids[k], variable: bv.variable.id, seen, of },
          got: { share },
          expected: { about: seen / of },
        }));
      });
    });
  },

  'weights.complete-and-relative': (variant, ctx) => {
    const { rng } = ctx;
    const base = baseStore(ctx, [4]);
    const bv = base.vars[0] as Base['vars'][number];
    const mix = variant === 'unseen-value' ? [0.5, 0.3, 0.2, 0] : evenMix(4);
    const { sessions } = drawn(rng, base, 40, mix);
    const rows = sessions.map((s) => ({ ...s, values: { ...s.values } }));
    if (variant === 'all-seen') {
      bv.ids.forEach((id, k) => {
        (rows[k] as ConversationInput).values = { [bv.variable.id]: id };
      });
    }
    if (variant === 'new-value') {
      for (let i = 0; i < 6; i += 1)
        (rows[i] as ConversationInput).values = { [bv.variable.id]: 'novelvalue' };
    }
    const store = build(ctx, { estate: base.estate, conversations: rows });
    const variable = variableOf(store, bv.variable.id) as StoreVariable;
    check(
      variable.values.every((v) => typeof v.weight === 'number'),
      () => ({
        rule: 'a variable weighs all of its values or none',
        got: { weights: variable.values.map((v) => [v.id, v.weight]) },
        expected: none('observation'),
      }),
    );
    let total = 0;
    let shares = 0;
    for (const value of variable.values) {
      total += weightOf(value, `value ${value.id} of ${variable.id}`);
      shares += shareOf(variable, value, `value ${value.id} of ${variable.id}`);
    }
    check(total > 0, () => ({
      rule: 'not every weight of a variable is N',
      input: { variable: variable.id },
      expected: none('observation'),
    }));
    check(Math.abs(shares - 1) <= 1e-9, () => ({
      rule: 'the shares of a variable add up to one',
      input: { variable: variable.id },
      got: { shares },
      expected: none('observation'),
    }));
    for (const value of variable.values) {
      const { count, total: of } = countsOf(value, `value ${value.id} of ${variable.id}`);
      const share = shareOf(variable, value, value.id);
      check(Math.abs(share - count / of) <= 1 / (of + 2) + 1e-9, () => ({
        rule: 'the share of a value agrees with its conversations count',
        input: { value: value.id, variable: variable.id, count, of },
        got: { share },
        expected: none('observation'),
      }));
    }
  },

  'weights.interval-holds-estimate': (variant, ctx) => {
    // An uninformative [0, 1] contains every estimate. Require a useful interval too,
    // including for the one-session variants where broad uncertainty is legitimate.
    for (const count of [25, 75]) {
      const [lo, hi] = callInterval(ctx, count, 100);
      check(lo <= count / 100 && hi >= count / 100 && hi - lo <= 1.5 * wilsonWidth(count, 100), () => ({
        rule: 'weightInterval contains its estimate with a useful width',
        input: { count, total: 100 },
        got: [lo, hi],
        expected: none('observation'),
      }));
    }
    const cases: Array<[number, number]> =
      variant === 'one-session'
        ? [
            [0, 1],
            [1, 1],
          ]
        : variant === 'all-same'
          ? [
              [20, 20],
              [0, 20],
              [1000, 1000],
            ]
          : [
              [7, 50],
              [25, 50],
              [1, 50],
              [49, 50],
              [333, 1000],
            ];
    for (const [count, total] of cases) {
      const [lo, hi] = callInterval(ctx, count, total);
      const p = count / total;
      check(
        Number.isFinite(lo) &&
          Number.isFinite(hi) &&
          lo >= 0 &&
          hi <= 1 &&
          lo <= p + 1e-12 &&
          p <= hi + 1e-12,
        () => ({
          rule: 'weightInterval is an interval inside N to N that holds its estimate',
          input: { count, total },
          got: [lo, hi],
          expected: none('observation'),
        }),
      );
    }
  },

  'weights.interval-coverage': (variant, ctx) => {
    const design = COVERAGE[variant] as { p: number; n: number; reps: number };
    const { p, n, reps } = design;
    const rng = subRng(ctx.rng, 'coverage');
    const mix = targetMix(p, 1);
    let inside = 0;
    for (let r = 0; r < reps; r += 1) {
      const picks = drawCategorical(rng, n, mix);
      const count = picks.filter((k) => k === 0).length;
      const [lo, hi] = callInterval(ctx, count, n);
      check(
        Number.isFinite(lo) &&
          Number.isFinite(hi) &&
          lo >= 0 &&
          hi <= 1 &&
          lo <= count / n + 1e-12 &&
          hi >= count / n - 1e-12 &&
          hi - lo <= 1.5 * wilsonWidth(count, n),
        () => ({
          rule: 'weightInterval contains its estimate with a useful width',
          input: { count, total: n },
          got: [lo, hi],
          expected: none('observation'),
        }),
      );
      if (lo <= p && p <= hi) inside += 1;
    }
    const need = coverageThreshold(reps, p, n);
    check(inside >= need, () => ({
      rule: 'a N percent interval holds the true share in enough replicates',
      input: { share: p, replicates: reps, sessions: n },
      got: { held: inside },
      expected: { atLeast: need, wilsonChance: wilsonCoverage(p, n) },
    }));
  },

  'weights.interval-width': (variant, ctx) => {
    const run = (n: number, p: number) => {
      const c = Math.round(p * n);
      const [lo, hi] = callInterval(ctx, c, n);
      return { width: hi - lo, wilson: wilsonWidth(c, n) };
    };
    if (variant === 'tenfold-sessions-shrinks') {
      const a = run(60, 0.3);
      const b = run(600, 0.3);
      const ratio = a.width / b.width;
      check(ratio >= 2.2 && ratio <= 4.5, () => ({
        rule: 'ten times the sessions narrow the interval by the factor the page implies',
        input: { sessions: [60, 600] },
        got: { widths: [a.width, b.width], factor: Number(ratio.toFixed(2)) },
        expected: { between: [2.2, 4.5] },
      }));
      return;
    }
    const [n, p] = variant === 'n100' ? [100, 0.5] : variant === 'n1000' ? [1000, 0.1] : [30, 0.2];
    const { width, wilson: ref } = run(n, p);
    check(width >= 0.6 * ref && width <= 1.5 * ref, () => ({
      rule: 'the interval has the width of a N percent Wilson interval',
      input: { count: Math.round(p * n), total: n },
      got: { width: Number(width.toFixed(4)) },
      expected: { between: [0.6 * ref, 1.5 * ref], wilsonWidth: ref },
    }));
  },

  'weights.interval-level': (variant, ctx) => {
    const [n, c] = variant === 'n400-half' ? [400, 200] : [2000, 200];
    const [lo, hi] = callInterval(ctx, c, n);
    const [wl, wh] = wilson(c, n, Z95);
    const half = (hi - lo) / 2;
    const ref = (wh - wl) / 2;
    check(Math.abs(half - ref) <= 0.15 * ref, () => ({
      rule: 'the half-width of the interval is that of a N percent interval',
      input: { count: c, total: n },
      got: { halfWidth: Number(half.toFixed(5)) },
      expected: { halfWidth: ref, within: 0.15 },
    }));
  },

  'weights.interval-huge-counts': (variant, ctx) => {
    const exponent = variant === 'n2-512' ? 512 : variant === 'n2-600' ? 600 : 900;
    const total = 2 ** exponent;
    const z2 = Z95 * Z95;
    const [lo0, hi0] = callInterval(ctx, 0, total);
    check(lo0 === 0 && Number.isFinite(hi0) && Math.abs(hi0 / (z2 / total) - 1) <= 1e-9, () => ({
      rule: 'the interval of no success in a huge total starts at N and ends at z squared over n',
      echoes: ['count'],
      input: { count: 0, total: `2^${exponent}` },
      got: [lo0, hi0],
      expected: [0, z2 / total],
    }));
    const [loAll, hiAll] = callInterval(ctx, total, total);
    check(hiAll === 1 && loAll >= 1 - 1e-9 && loAll <= 1, () => ({
      rule: 'the interval of every success in a huge total ends at N and starts just below it',
      input: { count: `2^${exponent}`, total: `2^${exponent}` },
      got: [loAll, hiAll],
      expected: none('observation'),
    }));
    const [loOne, hiOne] = callInterval(ctx, 1, total);
    check(
      Number.isFinite(loOne) &&
        Number.isFinite(hiOne) &&
        loOne >= 0 &&
        loOne <= 1 / total &&
        hiOne >= 1 / total &&
        hiOne > loOne,
      () => ({
        rule: 'the interval of one success in a huge total holds N over n with a width above N',
        input: { count: 1, total: `2^${exponent}` },
        got: [loOne, hiOne],
        expected: none('observation'),
      }),
    );
  },

  'weights.zero-count': (variant, ctx) => {
    const { rng } = ctx;
    const base = baseStore(ctx, [variant === 'among-seen' ? 4 : 3]);
    const bv = base.vars[0] as Base['vars'][number];
    const n = variant === 'n1000' ? 1000 : variant === 'n20' ? 20 : 60;
    const m = bv.ids.length;
    const mix = Array.from({ length: m }, (_, k) => (k === m - 1 ? 0 : 1 / (m - 1)));
    const { sessions } = drawn(rng, base, n, mix);
    const store = build(ctx, { estate: base.estate, conversations: sessions });
    const { variable, values } = after(store, base);
    const unseen = values[m - 1] as StoreValue;
    const label = `the unseen value ${unseen.id}`;
    const share = shareOf(variable, unseen, label);
    check(share >= 0 && share <= 1 / (n + 2) + 1e-9, () => ({
      rule: '{} was seen in N of {} sessions but has the share {}',
      got: { details: [label, n, share] },
      expected: none('observation'),
    }));
    const { count, total } = countsOf(unseen, label);
    check(count === 0 && total === n, () => ({
      rule: 'a value seen in no session carries the counts N of its sessions',
      input: { label },
      got: { count, total, sessions: n },
      expected: none('observation'),
    }));
    const [lo, hi] = callInterval(ctx, count, total);
    check(lo >= 0 && lo <= 1e-9 && hi > 0 && hi <= 1, () => ({
      rule: 'the interval of no success has a lower bound of N and an upper bound above N',
      input: { count: 0, total: n },
      got: [lo, hi],
      expected: none('observation'),
    }));
  },

  'weights.all-sessions-one-value': (variant, ctx) => {
    const base = baseStore(ctx, [3]);
    const n = variant === 'n1000' ? 1000 : 10;
    const store = build(ctx, { estate: base.estate, conversations: sessionsFromCounts(base, [n, 0, 0]) });
    const { variable, values } = after(store, base);
    const v = values[0] as StoreValue;
    const label = `the value seen in all ${n} sessions`;
    const share = shareOf(variable, v, label);
    check(share >= 1 - 1 / (n + 2) - 1e-9 && share <= 1 + 1e-9, () => ({
      rule: 'the only value of a variable holds about all of its weight',
      input: { label },
      got: { share },
      expected: none('observation'),
    }));
    const { count, total } = countsOf(v, label);
    const [lo, hi] = callInterval(ctx, count, total);
    check(hi >= 1 - 1e-12 && lo < 1 && lo >= 0, () => ({
      rule: 'the interval of every success has an upper bound of N and a lower bound below N',
      input: { count, total },
      got: [lo, hi],
      expected: none('observation'),
    }));
  },

  'weights.no-observation': (variant, ctx) => {
    const { rng } = ctx;
    const base = baseStore(ctx, variant === 'unobserved-variable' ? [3, 3] : [3]);
    let store: StoreDoc;
    const bv = base.vars[0] as Base['vars'][number];
    const ownerWeights = [0.4, 0.35, 0.25];
    if (variant === 'no-sessions') {
      store = build(ctx, { estate: base.estate, conversations: [] });
    } else if (variant === 'unobserved-variable') {
      const first = { ...base, vars: [base.vars[0] as Base['vars'][number]] };
      const { sessions } = draw(rng, first, 30, [evenMix(3)]);
      store = build(ctx, { estate: base.estate, conversations: sessions });
    } else {
      store = build(ctx, {
        estate: base.estate,
        owner: {
          weights: bv.ids.map((id, k) => ({
            variable: bv.variable.id,
            value: id,
            weight: ownerWeights[k] as number,
            date: OWNER_DATE,
            words: 'about forty percent',
          })),
        },
      });
    }
    for (const variable of store.variables) {
      for (const value of variable.values) {
        const label = `value ${value.id} of ${variable.id}`;
        if (value.weight !== undefined) {
          check(Number.isFinite(value.weight) && value.weight >= 0, () => ({
            rule: 'a stored weight is a finite number from N',
            input: { label },
            got: { weight: value.weight },
            expected: none('observation'),
          }));
        }
      }
    }
    if (variant === 'unobserved-variable') {
      const other = base.vars[1] as Base['vars'][number];
      const v = variableOf(store, other.variable.id) as StoreVariable;
      const weights = v.values.map((x) => x.weight);
      const some = weights.filter((w) => w !== undefined);
      check(some.length === 0 || (some.length === weights.length && new Set(some).size === 1), () => ({
        rule: 'a variable observed in no session has weights that are absent or all equal',
        input: { variable: v.id },
        got: { weights },
        expected: none('observation'),
      }));
    }
    if (variant === 'owner-only') {
      const variable = variableOf(store, bv.variable.id) as StoreVariable;
      bv.ids.forEach((id, k) => {
        const v = valueById(variable, id) as StoreValue;
        check(v.weight === ownerWeights[k], () => ({
          rule: 'an owner weight is stored as declared',
          input: { value: id, weight: ownerWeights[k] },
          got: { stored: v.weight },
          expected: none('observation'),
        }));
      });
    }
    const [lo, hi] = callInterval(ctx, 0, 1);
    check(Number.isFinite(lo) && Number.isFinite(hi) && lo >= 0 && hi <= 1 && hi > lo, () => ({
      rule: 'the interval of one session is finite, inside N to N, with a width above N',
      input: { count: 0, total: 1 },
      got: [lo, hi],
      expected: none('observation'),
    }));
  },

  'weights.recovered-mix': (variant, ctx) => {
    const rng = subRng(ctx.rng, 'recovered');
    const shapes = variant === 'twelve-skewed' ? 12 : variant === 'small-n' ? 3 : 4;
    const base = baseStore(ctx, [shapes]);
    const mix =
      variant === 'four-values'
        ? [0.4, 0.3, 0.2, 0.1]
        : variant === 'small-n'
          ? [0.6, 0.3, 0.1]
          : skewShares(rng, 12);
    const n = variant === 'four-values' ? 100 : variant === 'small-n' ? 15 : 200;
    const reps = 300;
    let inside = 0;
    for (let r = 0; r < reps; r += 1) {
      const { sessions } = drawn(rng, base, n, mix);
      const store = build(ctx, { estate: base.estate, conversations: sessions });
      const { variable, values } = after(store, base);
      values.forEach((value, k) => {
        const p = mix[k] as number;
        const w = shareOf(variable, value, `value ${k} (replicate ${r + 1})`);
        if (Math.abs(w - p) <= Z95 * Math.sqrt((p * (1 - p)) / n) + 1e-12) inside += 1;
      });
    }
    const m = mix.length;
    const total = reps * m;
    const expected = mix.reduce((acc, p) => acc + reps * bandInsideProbability(p, n), 0);
    const sd =
      Math.sqrt(m) *
      Math.sqrt(
        mix.reduce(
          (acc, p) => acc + reps * bandInsideProbability(p, n) * (1 - bandInsideProbability(p, n)),
          0,
        ),
      );
    const need = Math.floor(expected - 0.03 * total - 5.5 * sd);
    check(inside >= need, () => ({
      rule: 'recovered weights fall inside the N percent band of the planted mix often enough',
      input: { cases: total },
      got: { inside },
      expected: { atLeast: need, about: Math.round(expected) },
    }));
  },

  'weights.owner-kept-exactly': (variant, ctx) => {
    const base = baseStore(ctx, [3]);
    const bv = base.vars[0] as Base['vars'][number];
    const weights =
      variant === 'quarter'
        ? [0.25, 0.5, 0.25]
        : variant === 'third'
          ? [1 / 3, 1 / 3, 1 / 3]
          : variant === 'tiny'
            ? [1e-9, 0.5, 0.5]
            : [60, 15, 25];
    const store = build(ctx, {
      estate: base.estate,
      owner: {
        weights: bv.ids.map((id, k) => ({
          variable: bv.variable.id,
          value: id,
          weight: weights[k] as number,
          date: OWNER_DATE,
          words: 'the owner says so',
        })),
      },
    });
    const variable = variableOf(store, bv.variable.id) as StoreVariable;
    bv.ids.forEach((id, k) => {
      const v = valueById(variable, id) as StoreValue;
      check(v.weight === weights[k], () => ({
        rule: 'an owner weight is stored as declared',
        input: { value: id, weight: weights[k] },
        got: { stored: v.weight },
        expected: none('observation'),
      }));
    });
  },

  'weights.owner-invalid-refused': (variant, ctx) => {
    const base = baseStore(ctx, [3]);
    const bv = base.vars[0] as Base['vars'][number];
    const bad: unknown =
      variant === 'negative'
        ? -0.1
        : variant === 'null'
          ? null
          : variant === 'nan'
            ? Number.NaN
            : variant === 'infinity'
              ? Number.POSITIVE_INFINITY
              : '0.5';
    const id = bv.ids[1] as string;
    const store = build(ctx, {
      estate: base.estate,
      owner: {
        weights: [
          {
            variable: bv.variable.id,
            value: id,
            weight: bad as number,
            date: OWNER_DATE,
            words: 'a weight that cannot be right',
          },
        ],
      },
    });
    const v = valueById(variableOf(store, bv.variable.id) as StoreVariable, id) as StoreValue;
    check(v.weight === undefined, () => ({
      rule: 'an invalid owner weight is not stored',
      input: { weight: bad },
      got: { stored: v.weight },
      expected: none('observation'),
    }));
    const named = refusalsMentioning(store, id);
    check(
      named.length >= 1 && named.every((r) => typeof r.reason === 'string' && r.reason.trim() !== ''),
      () => ({
        rule: 'a refused weight is named in the refusal list with a reason',
        input: { id },
        got: { refusals: store.refused },
        expected: none('observation'),
      }),
    );
  },
};
