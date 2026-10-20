import { createHash } from 'node:crypto';
import { meaningOf } from '../../src/ladders/variables/blind/spans';
import type {
  Plan,
  PlanOptions,
  Row,
  Sources,
  StoreDoc,
  ValidateResult,
  VariablesImpl,
} from '../../src/ladders/variables/interface';
import { mutation as plannerMutation } from './reference/planner';
import { quoteMutation } from './reference/validate';

/**
 * Mutants of the reference: one wrong behaviour each, the kind of mistake a product makes. The bank must lose at
 * least one item on every mutant (the planted-bugs check of docs/validators.md 12.7, run here on the reference).
 */

export type Mutant = {
  name: string;
  /** The families whose items must lose at least one item on this mutant. */
  families: string[];
  make(base: VariablesImpl): { impl: VariablesImpl; reset?: () => void };
  /** Run only the items whose id ends with one of these (for the scale items, which are slow). */
  only?: string[];
};

const copy = <T>(x: T): T => structuredClone(x);

const planWith =
  (f: (p: Plan, store: StoreDoc, o: PlanOptions, base: VariablesImpl) => Plan): Mutant['make'] =>
  (base) => ({
    impl: { ...base, plan: (store, o) => f(copy(base.plan(store, o)), store, o, base) },
  });

const validateWith =
  (f: (r: ValidateResult, value: unknown) => ValidateResult): Mutant['make'] =>
  (base) => ({
    impl: { ...base, validate: (value) => f(base.validate(value), value) },
  });

/** Removes the errors that match; a store with no error left is valid. */
const dropErrors = (test: (code: string, path: string) => boolean): Mutant['make'] =>
  validateWith((r, value) => {
    if (r.ok) return r;
    const errors = r.errors.filter((e) => !test(e.code, e.path));
    return errors.length === 0 ? { ok: true, store: value, warnings: [] } : { ok: false, errors };
  });

const buildWith =
  (f: (s: StoreDoc, sources: Sources) => StoreDoc): Mutant['make'] =>
  (base) => ({
    impl: { ...base, buildStore: (sources) => f(copy(base.buildStore(sources)), sources) },
  });

const flag =
  (set: () => void, reset: () => void): Mutant['make'] =>
  (base) => {
    set();
    return { impl: base, reset };
  };

const resetPlanner = (): void => {
  Object.assign(plannerMutation, {
    ruleStrength: 3,
    noSharedPairs: false,
    detailPairs: false,
    noSingles: false,
    ignoreForbids: false,
    ignoreExtension: false,
  });
};
const resetQuotes = (): void => {
  Object.assign(quoteMutation, {
    skipWhitespace: false,
    skipZeroWidth: false,
    skipTypographic: false,
    skipNormalize: false,
    skipBackslash: false,
    ignoreCase: false,
    perQuoteUnreadable: false,
    ignoreHash: false,
  });
};

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Every object of a value, however deep, that the test accepts. */
function deepSome(value: unknown, test: (o: Record<string, unknown>) => boolean): boolean {
  if (Array.isArray(value)) return value.some((x) => deepSome(x, test));
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return test(o) || Object.values(o).some((x) => deepSome(x, test));
  }
  return false;
}

/** A validate that refuses a store the reference accepts, when the store has the feature. */
const refuseIf =
  (pred: (value: unknown) => boolean): Mutant['make'] =>
  (base) => ({
    impl: {
      ...base,
      validate: (value) => {
        const r = base.validate(value);
        return r.ok && pred(value) ? { ok: false, errors: [{ code: 'VARIABLES_PARSE', path: '' }] } : r;
      },
    },
  });

const buildFrom =
  (f: (sources: Sources) => Sources): Mutant['make'] =>
  (base) => ({ impl: { ...base, buildStore: (sources) => base.buildStore(f(copy(sources))) } });
const planFrom =
  (f: (store: StoreDoc, o: PlanOptions) => [StoreDoc, PlanOptions]): Mutant['make'] =>
  (base) => ({
    impl: {
      ...base,
      plan: (store, o) => {
        const [s2, o2] = f(copy(store), copy(o));
        return base.plan(s2, o2);
      },
    },
  });

export const MUTANTS: readonly Mutant[] = [
  // ---- the plan --------------------------------------------------------------------------------------------
  {
    name: 'plan drops its last new row',
    families: ['strength', 'impossible-pairs', 'seed-rows'],
    make: planWith((p) => {
      const i = p.rows.map((r) => r.kind).lastIndexOf('new');
      if (i >= 0) p.rows.splice(i, 1);
      return p;
    }),
  },
  {
    name: 'plan puts the seeds after the new rows',
    families: ['seed-rows'],
    make: planWith((p) => {
      p.rows = [...p.rows.filter((r) => r.kind === 'new'), ...p.rows.filter((r) => r.kind === 'seed')];
      return p;
    }),
  },
  {
    name: 'plan drops the seeds',
    families: ['seed-rows'],
    make: planWith((p) => {
      p.rows = p.rows.filter((r) => r.kind !== 'seed');
      return p;
    }),
  },
  {
    name: 'plan labels seeds as new',
    families: ['seed-rows'],
    make: planWith((p) => {
      for (const r of p.rows) r.kind = 'new';
      return p;
    }),
  },
  {
    name: 'plan completes partial seeds',
    families: ['seed-rows'],
    make: planWith((p, store) => {
      for (const r of p.rows)
        if (r.kind === 'seed')
          for (const v of store.variables)
            if (r.values[v.id] === undefined) r.values[v.id] = (v.values[0] as { id: string }).id;
      return p;
    }),
  },
  {
    name: 'plan orders the rarest rows first',
    families: ['budget-order'],
    make: planWith((p) => {
      const seeds = p.rows.filter((r) => r.kind === 'seed');
      p.rows = [...seeds, ...p.rows.filter((r) => r.kind === 'new').reverse()];
      return p;
    }),
  },
  {
    name: 'plan counts the budget on new rows only',
    families: ['budget-order'],
    make: (base) => ({
      impl: {
        ...base,
        plan: (store, o) => {
          const { budget, ...rest } = o;
          const full = base.plan(store, rest);
          if (budget === undefined) return full;
          base.plan(store, o);
          const seeds = full.rows.filter((r) => r.kind === 'seed');
          return { ...full, rows: [...seeds, ...full.rows.filter((r) => r.kind === 'new').slice(0, budget)] };
        },
      },
    }),
  },
  {
    name: 'plan keeps the rarest rows when it cuts',
    families: ['budget-order'],
    make: (base) => ({
      impl: {
        ...base,
        plan: (store, o) => {
          const { budget, ...rest } = o;
          const full = base.plan(store, rest);
          if (budget === undefined) return full;
          base.plan(store, o);
          const seeds = full.rows.filter((r) => r.kind === 'seed');
          const fresh = full.rows.filter((r) => r.kind === 'new');
          return {
            ...full,
            rows: [...seeds, ...fresh.slice(Math.max(0, fresh.length - Math.max(0, budget - seeds.length)))],
          };
        },
      },
    }),
  },
  {
    name: 'plan drops seeds when the budget is below their count',
    families: ['budget-order'],
    make: planWith((p, _s, o) => {
      if (o.budget !== undefined) p.rows = p.rows.slice(0, o.budget);
      return p;
    }),
  },
  {
    name: 'plan accepts a negative budget',
    families: ['budget-order'],
    make: (base) => ({
      impl: {
        ...base,
        plan: (store, o) =>
          base.plan(store, o.budget !== undefined && o.budget < 0 ? { ...o, budget: undefined } : o),
      },
    }),
  },
  {
    name: 'plan accepts a fractional budget',
    families: ['budget-order'],
    make: (base) => ({
      impl: {
        ...base,
        plan: (store, o) =>
          base.plan(
            store,
            o.budget !== undefined && !Number.isInteger(o.budget) && Number.isFinite(o.budget)
              ? { ...o, budget: Math.floor(o.budget) }
              : o,
          ),
      },
    }),
  },
  {
    name: 'plan throws a plain Error for a bad budget',
    families: ['budget-order'],
    make: (base) => ({
      impl: {
        ...base,
        plan: (store, o) => {
          try {
            return base.plan(store, o);
          } catch (e) {
            throw new Error((e as Error).message.replace('budget', 'the limit'));
          }
        },
      },
    }),
  },
  {
    name: 'plan writes the product of shares, not the sum of logs',
    families: ['budget-order'],
    make: planWith((p) => {
      for (const r of p.rows)
        if (r.logWeight !== null) r.logWeight = Number(Math.exp(r.logWeight).toFixed(9));
      return p;
    }),
  },
  {
    name: 'plan writes six places',
    families: ['budget-order'],
    make: planWith((p) => {
      for (const r of p.rows) if (r.logWeight !== null) r.logWeight = Number(r.logWeight.toFixed(6));
      return p;
    }),
  },
  {
    name: 'plan writes a number for minus infinity',
    families: ['budget-order'],
    make: planWith((p) => {
      for (const r of p.rows) if (r.logWeight === null) r.logWeight = -1e9;
      return p;
    }),
  },
  {
    name: 'plan drops its warnings',
    families: ['seed-rows', 'impossible-pairs'],
    make: planWith((p) => {
      delete p.warnings;
      return p;
    }),
  },
  {
    name: 'plan drops its coverage report',
    families: ['strength', 'budget-order'],
    make: planWith((p) => {
      delete p.report;
      return p;
    }),
  },
  {
    name: 'plan overstates the allowed tuples',
    families: ['strength', 'budget-order'],
    make: planWith((p) => {
      if (p.report) p.report.allowed = Number(p.report.allowed) + 1;
      return p;
    }),
  },
  {
    name: 'plan gives every row the same id',
    families: ['seed-rows'],
    make: planWith((p) => {
      for (const r of p.rows) r.id = 'row';
      return p;
    }),
  },
  {
    name: 'plan repeats a seed as a new row',
    families: ['seed-rows'],
    make: planWith((p) => {
      const s = p.rows.find((r) => r.kind === 'seed');
      if (s) p.rows.push({ ...copy(s), id: 'dup', kind: 'new' });
      return p;
    }),
  },
  {
    name: 'plan shuffles equal calls',
    families: ['seed-rows', 'budget-order'],
    make: planWith((p) => {
      const seeds = p.rows.filter((r) => r.kind === 'seed');
      const fresh = p.rows.filter((r) => r.kind === 'new');
      for (let i = fresh.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [fresh[i], fresh[j]] = [fresh[j] as (typeof fresh)[number], fresh[i] as (typeof fresh)[number]];
      }
      p.rows = [...seeds, ...fresh];
      return p;
    }),
  },
  {
    name: 'plan changes the store it is given',
    families: ['seed-rows'],
    make: (base) => ({
      impl: {
        ...base,
        plan: (store, o) => {
          const out = base.plan(store, o);
          const v = store.variables[0];
          if (v) v.title = `${v.title ?? ''}.`;
          return out;
        },
      },
    }),
  },
  {
    name: 'plan changes the seeds it is given',
    families: ['seed-rows'],
    make: (base) => ({
      impl: {
        ...base,
        plan: (store, o) => {
          const out = base.plan(store, o);
          for (const s of o.seeds ?? []) s.touched = 'x';
          return out;
        },
      },
    }),
  },
  {
    name: 'plan caches by store object',
    families: ['seed-rows'],
    make: (base) => {
      const cache = new WeakMap<object, Plan>();
      return {
        impl: {
          ...base,
          plan: (store, o) => {
            const hit = cache.get(store);
            if (hit) return hit;
            const out = base.plan(store, o);
            cache.set(store, out);
            return out;
          },
        },
      };
    },
  },
  {
    name: 'plan rejects seed zero',
    families: ['seed-rows'],
    make: (base) => ({
      impl: {
        ...base,
        plan: (store, o) => {
          if (o.seed === 0 || o.seed < 0) throw new RangeError('seed must be positive');
          return base.plan(store, o);
        },
      },
    }),
  },
  {
    name: 'plan keeps unknown entries in a seed',
    families: ['seed-rows'],
    make: planWith((p, _s, o) => {
      (o.seeds ?? []).forEach((seed, i) => {
        const row = p.rows[i];
        if (row?.kind === 'seed') row.values = { ...seed };
      });
      return p;
    }),
  },
  {
    name: 'plan never warns about a forbidden seed',
    families: ['seed-rows'],
    make: planWith((p) => {
      p.warnings = (p.warnings ?? []).filter((w) => w.code !== 'seed_forbidden');
      return p;
    }),
  },
  {
    name: 'plan never warns about an unreachable value',
    families: ['impossible-pairs'],
    make: planWith((p) => {
      p.warnings = (p.warnings ?? []).filter((w) => w.code !== 'value_unreachable');
      return p;
    }),
  },
  // ---- the planner, one rule at a time ---------------------------------------------------------------------
  {
    name: 'rules are crossed at strength 2',
    families: ['strength'],
    make: flag(() => {
      plannerMutation.ruleStrength = 2;
    }, resetPlanner),
  },
  {
    name: 'rules are crossed at strength 1',
    families: ['strength'],
    make: flag(() => {
      plannerMutation.ruleStrength = 1;
    }, resetPlanner),
  },
  {
    name: 'axes are not crossed in pairs',
    families: ['strength'],
    make: flag(() => {
      plannerMutation.noSharedPairs = true;
    }, resetPlanner),
  },
  {
    name: 'details are crossed in pairs too',
    families: ['strength'],
    make: flag(() => {
      plannerMutation.detailPairs = true;
    }, resetPlanner),
  },
  {
    name: 'values no group names are never required',
    families: ['strength'],
    make: flag(() => {
      plannerMutation.noSingles = true;
    }, resetPlanner),
  },
  {
    name: 'impossible combinations are ignored',
    families: ['impossible-pairs'],
    make: flag(() => {
      plannerMutation.ignoreForbids = true;
    }, resetPlanner),
  },
  {
    name: 'extendability is ignored when counting',
    families: ['counter'],
    make: flag(() => {
      plannerMutation.ignoreExtension = true;
    }, resetPlanner),
  },
  // ---- the counter -----------------------------------------------------------------------------------------
  {
    name: 'coverage uses numbers beyond the safe range',
    families: ['counter'],
    make: (base) => ({
      impl: {
        ...base,
        coverage: (...a) => {
          const r = base.coverage(...a);
          return { ...r, allowed: Number(r.allowed), covered: Number(r.covered) };
        },
      },
    }),
  },
  {
    name: 'coverage adds up its groups',
    families: ['counter'],
    make: (base) => ({
      impl: {
        ...base,
        coverage: (store, rows, groups, o) => {
          if (groups.length < 2) return base.coverage(store, rows, groups, o);
          let allowed = 0;
          let covered = 0;
          for (const g of groups) {
            const r = base.coverage(store, rows, [g]);
            allowed += Number(r.allowed);
            covered += Number(r.covered);
          }
          return { allowed, covered };
        },
      },
    }),
  },
  {
    name: 'coverage counts repeated rows again',
    families: ['counter'],
    make: (base) => ({
      impl: {
        ...base,
        coverage: (store, rows, groups, o) => {
          const seen = new Set<string>();
          let covered = 0;
          for (const r of rows) {
            const c = Number(base.coverage(store, [r], groups).covered);
            covered += c;
            seen.add(JSON.stringify(r));
          }
          const all = base.coverage(store, rows, groups, o);
          return rows.length > 0 && seen.size < rows.length ? { ...all, covered } : all;
        },
      },
    }),
  },
  {
    name: 'coverage credits a partial row for what it leaves out',
    families: ['counter'],
    make: (base) => ({
      impl: {
        ...base,
        coverage: (store, rows, groups, o) =>
          base.coverage(
            store,
            rows.map((r) => {
              const full: Row = { ...r };
              for (const v of store.variables)
                if (full[v.id] === undefined) full[v.id] = (v.values[0] as { id: string }).id;
              return full;
            }),
            groups,
            o,
          ),
      },
    }),
  },
  {
    name: 'coverage lists one tuple too few',
    families: ['counter'],
    make: (base) => ({
      impl: {
        ...base,
        coverage: (...a) => {
          const r = base.coverage(...a);
          if (r.uncovered && r.uncovered.length > 0) r.uncovered = r.uncovered.slice(0, -1);
          return r;
        },
      },
    }),
  },
  {
    name: 'coverage never lists tuples',
    families: ['counter'],
    make: (base) => ({
      impl: {
        ...base,
        coverage: (...a) => {
          const r = base.coverage(...a);
          delete r.uncovered;
          return r;
        },
      },
    }),
  },
  {
    name: 'coverage accepts an unknown variable',
    families: ['counter'],
    make: (base) => ({
      impl: {
        ...base,
        coverage: (store, rows, groups, o) =>
          base.coverage(
            store,
            rows,
            groups.map((g) => ({
              ...g,
              variables: g.variables.filter((v) => store.variables.some((x) => x.id === v)),
            })),
            o,
          ),
      },
    }),
  },
  {
    name: 'coverage throws a plain Error',
    families: ['counter'],
    make: (base) => ({
      impl: {
        ...base,
        coverage: (...a) => {
          try {
            return base.coverage(...a);
          } catch (e) {
            throw new Error((e as Error).message);
          }
        },
      },
    }),
  },
  {
    name: 'coverage error does not name the strength',
    families: ['counter'],
    make: (base) => ({
      impl: {
        ...base,
        coverage: (...a) => {
          try {
            return base.coverage(...a);
          } catch (e) {
            throw new RangeError((e as Error).message.replace('strength', 'the number'));
          }
        },
      },
    }),
  },
  // ---- the interval ----------------------------------------------------------------------------------------
  {
    name: 'interval is the constant zero to one',
    families: ['weights'],
    make: (base) => ({ impl: { ...base, weightInterval: () => [0, 1] } }),
  },
  {
    name: 'interval is the normal approximation',
    families: ['weights'],
    make: (base) => ({
      impl: {
        ...base,
        weightInterval: (c, n) => {
          const p = c / n;
          const h = 1.959963984540054 * Math.sqrt((p * (1 - p)) / n);
          return [Math.max(0, p - h), Math.min(1, p + h)];
        },
      },
    }),
  },
  {
    name: 'interval uses z of 1.96',
    families: ['weights'],
    make: (base) => ({
      impl: {
        ...base,
        weightInterval: (c, n) => {
          const z = 1.96;
          const p = c / n;
          const d = 1 + (z * z) / n;
          const m = (p + (z * z) / (2 * n)) / d;
          const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
          return [Math.max(0, m - h), Math.min(1, m + h)];
        },
      },
    }),
  },
  {
    name: 'interval is not clamped',
    families: ['weights'],
    make: (base) => ({
      impl: {
        ...base,
        weightInterval: (c, n) => {
          const z = 1.959963984540054;
          const p = c / n;
          const d = 1 + (z * z) / n;
          const m = (p + (z * z) / (2 * n)) / d;
          const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
          return [m - h, m + h];
        },
      },
    }),
  },
  {
    name: 'interval is swapped',
    families: ['weights'],
    make: (base) => ({
      impl: {
        ...base,
        weightInterval: (c, n) => {
          const [lo, hi] = base.weightInterval(c, n);
          return [hi, lo];
        },
      },
    }),
  },
  // ---- validate and quotes ---------------------------------------------------------------------------------
  {
    name: 'validate lets a value id repeat',
    families: ['values'],
    make: dropErrors((c, p) => c === 'VARIABLES_DUPLICATE' && p.includes('.values.')),
  },
  {
    name: 'validate lets a variable id repeat',
    families: ['values'],
    make: dropErrors((c, p) => c === 'VARIABLES_DUPLICATE' && /^variables\.\d+\.id$/.test(p)),
  },
  {
    name: 'validate lets a constraint repeat',
    families: ['values'],
    make: dropErrors((c, p) => c === 'VARIABLES_DUPLICATE' && p.startsWith('constraints')),
  },
  {
    name: 'validate lets a value sit in two axes',
    families: ['values'],
    make: dropErrors((c) => c === 'VARIABLES_AMBIGUOUS_VALUE'),
  },
  {
    name: 'validate lets an axis kind repeat',
    families: ['values'],
    make: dropErrors((c) => c === 'VARIABLES_KIND_REPEATED'),
  },
  {
    name: 'validate accepts an unknown deviation class',
    families: ['values'],
    make: dropErrors((c) => c === 'VARIABLES_UNKNOWN_DEVIATION'),
  },
  {
    name: 'validate accepts an empty constraint',
    families: ['values'],
    make: dropErrors((c) => c === 'VARIABLES_EMPTY_CONSTRAINT'),
  },
  {
    name: 'validate accepts a constraint on a missing variable',
    families: ['values'],
    make: dropErrors((c) => c === 'VARIABLES_UNKNOWN_VARIABLE'),
  },
  {
    name: 'validate accepts a missing value in a reference',
    families: ['values', 'boundaries'],
    make: dropErrors((c) => c === 'VARIABLES_UNKNOWN_VALUE'),
  },
  {
    name: 'validate accepts a grid with no cell',
    families: ['values'],
    make: dropErrors((c) => c === 'VARIABLES_GRID_EMPTY'),
  },
  {
    name: 'validate accepts a fitted prior with no source',
    families: ['values'],
    make: dropErrors((c) => c === 'VARIABLES_PRIOR_SOURCE'),
  },
  {
    name: 'validate accepts a boundary with the edge on the wrong side',
    families: ['boundaries'],
    make: dropErrors((c, p) => c === 'VARIABLES_BOUNDARY' && p.endsWith('.edge')),
  },
  {
    name: 'validate accepts one value on both sides',
    families: ['boundaries'],
    make: dropErrors((c, p) => c === 'VARIABLES_BOUNDARY' && p.endsWith('.fails')),
  },
  {
    name: 'validate accepts a limit without a comparison',
    families: ['boundaries'],
    make: dropErrors((c, p) => c === 'SCHEMA_CUSTOM' && p.includes('.boundaries.')),
  },
  {
    name: 'validate accepts a comparison outside the list',
    families: ['boundaries'],
    make: dropErrors((c, p) => c === 'SCHEMA_INVALID_VALUE' && p.endsWith('.comparison')),
  },
  {
    name: 'validate accepts a limit that is not finite',
    families: ['boundaries'],
    make: dropErrors((_c, p) => p.endsWith('.limit')),
  },
  {
    name: 'validate accepts incomplete weights',
    families: ['weights'],
    make: dropErrors((c) => c === 'VARIABLES_WEIGHT_INCOMPLETE'),
  },
  {
    name: 'validate accepts weights that are all zero',
    families: ['weights'],
    make: dropErrors((c) => c === 'VARIABLES_WEIGHT_ZERO'),
  },
  {
    name: 'validate accepts a negative weight',
    families: ['weights'],
    make: dropErrors((c, p) => c === 'SCHEMA_TOO_SMALL' && p.endsWith('.weight')),
  },
  {
    name: 'validate accepts an id that starts with a hyphen',
    families: ['values'],
    make: dropErrors((c, p) => c === 'SCHEMA_INVALID_FORMAT' && p.endsWith('.id')),
  },
  {
    name: 'validate accepts an unknown key',
    families: ['values', 'boundaries', 'sources'],
    make: dropErrors((c) => c === 'SCHEMA_UNRECOGNIZED_KEYS'),
  },
  {
    name: 'validate accepts a count above the total',
    families: ['sources'],
    make: dropErrors((c, p) => c === 'SCHEMA_CUSTOM' && p.includes('.provenance.')),
  },
  {
    name: 'validate accepts an unreal date',
    families: ['sources'],
    make: dropErrors((c, p) => c === 'SCHEMA_INVALID_FORMAT' && p.endsWith('.date')),
  },
  {
    name: 'validate accepts a ledger id in capitals',
    families: ['sources'],
    make: dropErrors((c, p) => c === 'SCHEMA_INVALID_FORMAT' && p.endsWith('.ledger')),
  },
  {
    name: 'validate accepts a hash in capitals',
    families: ['sources'],
    make: dropErrors(
      (c, p) => c === 'SCHEMA_INVALID_FORMAT' && (p.endsWith('.set_hash') || p.endsWith('.hash')),
    ),
  },
  {
    name: 'validate accepts a quote over a thousand characters',
    families: ['sources'],
    make: dropErrors((c) => c === 'SCHEMA_TOO_BIG'),
  },
  {
    name: 'validate accepts an entry of an unknown kind',
    families: ['sources'],
    make: dropErrors((c) => c === 'SCHEMA_INVALID_UNION'),
  },
  {
    name: 'validate reports a repeated id at the first place',
    families: ['values'],
    make: validateWith((r) =>
      r.ok
        ? r
        : {
            ok: false,
            errors: r.errors.map((e) =>
              e.code === 'VARIABLES_DUPLICATE'
                ? { ...e, path: e.path.replace(/values\.\d+/, 'values.0') }
                : e,
            ),
          },
    ),
  },
  {
    name: 'validate reports the first weight',
    families: ['weights'],
    make: validateWith((r) =>
      r.ok
        ? r
        : {
            ok: false,
            errors: r.errors.map((e) =>
              e.code === 'VARIABLES_WEIGHT_INCOMPLETE'
                ? { ...e, path: e.path.replace(/values\.\d+/, 'values.0') }
                : e,
            ),
          },
    ),
  },
  {
    name: 'validate throws on a bad store',
    families: ['values'],
    make: validateWith((r) => {
      if (!r.ok) throw new Error('bad store');
      return r;
    }),
  },
  {
    name: 'validate gives no advice',
    families: ['sources'],
    make: validateWith((r) => (r.ok ? { ...r, warnings: [] } : r)),
  },
  {
    name: 'quotes matches without folding white space',
    families: ['quotes'],
    make: flag(() => {
      quoteMutation.skipWhitespace = true;
    }, resetQuotes),
  },
  {
    name: 'quotes matches without folding typographic quotes',
    families: ['quotes'],
    make: flag(() => {
      quoteMutation.skipTypographic = true;
    }, resetQuotes),
  },
  {
    name: 'quotes matches without folding accents',
    families: ['quotes'],
    make: flag(() => {
      quoteMutation.skipNormalize = true;
    }, resetQuotes),
  },
  {
    name: 'quotes matches without dropping zero-width characters',
    families: ['quotes'],
    make: flag(() => {
      quoteMutation.skipZeroWidth = true;
    }, resetQuotes),
  },
  {
    name: 'quotes matches without folding the markdown backslash',
    families: ['quotes'],
    make: flag(() => {
      quoteMutation.skipBackslash = true;
    }, resetQuotes),
  },
  {
    name: 'quotes ignores case',
    families: ['quotes'],
    make: flag(() => {
      quoteMutation.ignoreCase = true;
    }, resetQuotes),
  },
  {
    name: 'quotes reports a missing file once per quote',
    families: ['quotes'],
    make: flag(() => {
      quoteMutation.perQuoteUnreadable = true;
    }, resetQuotes),
  },
  {
    name: 'quotes does not compare the hash',
    families: ['quotes'],
    make: flag(() => {
      quoteMutation.ignoreHash = true;
    }, resetQuotes),
  },
  {
    name: 'quotes reports a missing file as a missing quote',
    families: ['quotes'],
    make: (base) => ({
      impl: {
        ...base,
        quotes: (...a) => {
          const r = base.quotes(...a);
          return {
            errors: r.errors.map((e) =>
              e.code === 'VARIABLES_SOURCE_UNREADABLE'
                ? { code: 'VARIABLES_QUOTE_NOT_FOUND', path: e.path.replace(/\.path$/, '.quote') }
                : e,
            ),
          };
        },
      },
    }),
  },
  {
    name: 'quotes reports the wrong path',
    families: ['quotes'],
    make: (base) => ({
      impl: {
        ...base,
        quotes: (...a) => ({
          errors: base.quotes(...a).errors.map((e) => ({ ...e, path: e.path.replace(/\.quote$/, '') })),
        }),
      },
    }),
  },
  {
    name: 'quotes throws on a missing file',
    families: ['quotes'],
    make: (base) => ({
      impl: {
        ...base,
        quotes: (...a) => {
          const r = base.quotes(...a);
          if (r.errors.some((e) => e.code === 'VARIABLES_SOURCE_UNREADABLE')) throw new Error('ENOENT');
          return r;
        },
      },
    }),
  },
  // ---- the readers -----------------------------------------------------------------------------------------
  {
    name: 'reader drops provenance',
    families: ['sources', 'quotes'],
    make: buildWith((s) => {
      for (const v of s.variables) for (const x of v.values) delete x.provenance;
      return s;
    }),
  },
  {
    name: 'reader keeps a value whose quote is not in its file',
    families: ['quotes'],
    make: (base) => ({
      impl: {
        ...base,
        buildStore: (sources) => {
          if (!sources.estate) return base.buildStore(sources);
          const all = Object.values(sources.estate.files).join('\n');
          const quotes = sources.estate.rules.flatMap((r) => [
            ...r.conditions.map((c) => c.text),
            ...r.tools.flatMap((t) => t.values.map((v) => v.quote)),
          ]);
          const files = Object.fromEntries(
            Object.keys(sources.estate.files).map((k) => [k, `${all}\n${quotes.join('\n')}`]),
          );
          return base.buildStore({ ...sources, estate: { ...sources.estate, files } });
        },
      },
    }),
  },
  {
    name: 'reader gives a refusal no reason',
    families: ['quotes', 'impossible-pairs', 'weights'],
    make: buildWith((s) => {
      for (const r of s.refused) r.reason = r.what;
      return s;
    }),
  },
  {
    name: 'reader leaks conversation identifiers',
    families: ['sources'],
    make: buildWith((s, src) => {
      const v = s.variables[0];
      if (v && src.conversations?.length) v.title = `${v.title ?? ''} ${src.conversations[0]?.id}`;
      return s;
    }),
  },
  {
    name: 'reader leaks conversation text',
    families: ['sources'],
    make: buildWith((s, src) => {
      const v = s.variables[0];
      const t = src.conversations?.find((c) => c.text)?.text;
      if (v && t) v.title = `${v.title ?? ''} ${t}`;
      return s;
    }),
  },
  {
    name: 'reader counts missing observations in the total',
    families: ['sources', 'weights'],
    make: buildWith((s, src) => {
      const n = src.conversations?.length ?? 0;
      for (const v of s.variables)
        for (const x of v.values)
          for (const p of x.provenance ?? []) if (p.kind === 'conversations') p.total = n;
      return s;
    }),
  },
  {
    name: 'reader creates a variable for an unknown one',
    families: ['sources'],
    make: buildWith((s, src) => {
      for (const c of src.conversations ?? [])
        for (const k of Object.keys(c.values))
          if (!s.variables.some((v) => v.id === k)) {
            s.variables.push({ id: k, values: [{ id: String(c.values[k]), provenance: [] }] });
            s.refused = s.refused.filter((r) => !r.what.includes(k));
          }
      return s;
    }),
  },
  {
    name: 'reader approves what conversations proposed',
    families: ['sources', 'weights'],
    make: buildWith((s) => {
      for (const v of s.variables) for (const x of v.values) if (x.approved === false) delete x.approved;
      return s;
    }),
  },
  {
    name: 'reader gives ids that depend on the order',
    families: ['values'],
    make: (base) => ({
      impl: {
        ...base,
        buildStore: (sources) => {
          const s = copy(base.buildStore(sources));
          const names = new Map<string, string>();
          s.variables.forEach((v, i) => {
            const n = `${v.id}_${sources.estate?.rules.length ?? 0}${i}`;
            names.set(v.id, n);
            v.id = n;
          });
          for (const r of s.rules) r.variables = r.variables.map((x) => names.get(x) ?? x);
          return s;
        },
      },
    }),
  },
  {
    name: 'reader trims the owner words',
    families: ['values', 'impossible-pairs'],
    make: buildWith((s) => {
      for (const v of s.variables)
        for (const x of v.values)
          for (const p of x.provenance ?? []) if (p.kind === 'owner') p.words = p.words.trim();
      return s;
    }),
  },
  {
    name: 'reader adds an owner value twice',
    families: ['values'],
    make: buildWith((s, src) => {
      for (const o of src.owner?.values ?? []) {
        const v = s.variables.find((x) => x.id === o.variable);
        const hit = v?.values.find((x) => x.id === o.value);
        if (v && hit) v.values.push(copy(hit));
      }
      return s;
    }),
  },
  {
    name: 'reader keeps both orders of an owner pair',
    families: ['impossible-pairs'],
    make: buildWith((s) => {
      for (const p of [...s.impossible]) s.impossible.push({ ...copy(p), a: p.b, b: p.a });
      return s;
    }),
  },
  {
    name: 'reader accepts an owner pair that names nothing',
    families: ['impossible-pairs'],
    make: buildWith((s, src) => {
      for (const p of src.owner?.impossible ?? [])
        if (
          !s.variables.some((v) => v.id === p.a.variable) ||
          !s.variables.some((v) => v.id === p.b.variable)
        )
          s.impossible.push({
            a: p.a,
            b: p.b,
            provenance: [{ kind: 'owner', words: p.words, date: p.date }],
          });
      return s;
    }),
  },
  {
    name: 'reader turns owner weights into shares',
    families: ['weights'],
    make: buildWith((s, src) => {
      for (const v of s.variables) {
        const sum = v.values.reduce((n, x) => n + (x.weight ?? 0), 0);
        if (src.owner?.weights?.length && sum > 0)
          for (const x of v.values) if (x.weight !== undefined) x.weight = x.weight / sum;
      }
      return s;
    }),
  },
  {
    name: 'reader gives conversation weights to an unobserved variable',
    families: ['weights'],
    make: buildWith((s) => {
      for (const v of s.variables)
        if (!v.values.some((x) => x.weight !== undefined)) for (const x of v.values) x.weight = 1;
      return s;
    }),
  },
  {
    name: 'reader drops the weights of conversations',
    families: ['weights'],
    make: buildWith((s) => {
      for (const v of s.variables)
        for (const x of v.values) if (x.provenance?.some((p) => p.kind === 'conversations')) delete x.weight;
      return s;
    }),
  },
  {
    name: 'reader writes the set hash from the order of sessions',
    families: ['sources'],
    make: buildWith((s, src) => {
      const h = sha((src.conversations ?? []).map((c) => c.id).join(','));
      for (const v of s.variables)
        for (const x of v.values)
          for (const p of x.provenance ?? []) if (p.kind === 'conversations') p.set_hash = h;
      return s;
    }),
  },
  {
    name: 'reader writes the set hash in capitals',
    families: ['sources'],
    make: buildWith((s) => {
      for (const v of s.variables)
        for (const x of v.values)
          for (const p of x.provenance ?? [])
            if (p.kind === 'conversations') p.set_hash = p.set_hash.toUpperCase();
      return s;
    }),
  },
  {
    name: 'reader drops the edge sample of a condition',
    families: ['boundaries', 'sources'],
    make: buildWith((s) => {
      for (const v of s.variables) {
        const b = v.boundaries?.[0];
        if (b) v.values = v.values.filter((x) => x.id !== b.edge);
      }
      return s;
    }),
  },
  {
    name: 'reader swaps holds and fails',
    families: ['boundaries'],
    make: buildWith((s) => {
      for (const v of s.variables)
        for (const b of v.boundaries ?? []) [b.holds, b.fails] = [b.fails, b.holds];
      return s;
    }),
  },
  {
    name: 'reader gives the edge the value of a side',
    families: ['boundaries'],
    make: buildWith((s) => {
      for (const v of s.variables) for (const b of v.boundaries ?? []) b.edge = b.holds;
      return s;
    }),
  },
  {
    name: 'reader merges every numeric variable into one',
    families: ['sources'],
    make: buildWith((s) => {
      const numeric = s.variables.filter((v) => v.values.some((x) => typeof x.sample === 'number'));
      if (numeric.length > 1) {
        const first = numeric[0] as StoreDoc['variables'][number];
        for (const v of numeric.slice(1)) {
          first.values.push(...v.values.map((x) => ({ ...x, id: `${v.id}_${x.id}` })));
        }
        s.variables = s.variables.filter((v) => v === first || !numeric.includes(v));
      }
      return s;
    }),
  },
  {
    name: 'reader keeps duplicate samples when spans merge',
    families: ['boundaries'],
    make: buildWith((s) => {
      for (const v of s.variables)
        if (v.boundaries && v.boundaries.length > 1)
          v.values.push(
            ...v.values
              .filter((x) => typeof x.sample === 'number')
              .map((x) => ({ ...x, id: `${x.id}_again` })),
          );
      return s;
    }),
  },
  {
    name: 'reader lists no variable for a rule',
    families: ['sources'],
    make: buildWith((s) => {
      for (const r of s.rules) r.variables = [];
      return s;
    }),
  },
  {
    name: 'reader gives every sample a whole number even for a decimal limit',
    families: ['boundaries'],
    make: buildWith((s) => {
      for (const v of s.variables)
        for (const x of v.values) if (typeof x.sample === 'number') x.sample = Math.round(x.sample);
      return s;
    }),
  },
  {
    name: 'reader throws on a name like a prototype member',
    families: ['values'],
    make: (base) => ({
      impl: {
        ...base,
        buildStore: (sources) => {
          for (const r of sources.estate?.rules ?? [])
            for (const t of r.tools)
              if (['constructor', '__proto__', 'toString'].includes(t.field))
                throw new TypeError('bad field');
          return base.buildStore(sources);
        },
      },
    }),
  },
  {
    name: 'reader loses a variable on a name collision',
    families: ['values'],
    make: buildWith((s) => {
      const seen = new Set<string>();
      s.variables = s.variables.filter((v) => {
        const k = v.id.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return s;
    }),
  },
  {
    name: 'reader keeps ids that break the grammar',
    families: ['values'],
    make: buildWith((s) => {
      for (const v of s.variables)
        for (const x of v.values) if (x.title && /[ !]/.test(x.title)) x.id = x.title;
      return s;
    }),
  },
  {
    name: 'reader accepts a blank owner value',
    families: ['values'],
    make: buildWith((s, src) => {
      for (const o of src.owner?.values ?? [])
        if (o.words.trim() === '') {
          const v = s.variables.find((x) => x.id === o.variable);
          if (v && !v.values.some((x) => x.id === o.value))
            v.values.push({ id: o.value, provenance: [{ kind: 'owner', words: o.words, date: o.date }] });
        }
      return s;
    }),
  },
  {
    name: 'reader accepts an unreal owner date',
    families: ['values'],
    make: buildWith((s, src) => {
      for (const o of src.owner?.values ?? [])
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(o.date) ||
          Number.isNaN(Date.parse(o.date)) ||
          (o.date.slice(5, 7) === '02' && Number(o.date.slice(8, 10)) > 28 && !(o.date === '2028-02-29'))
        ) {
          const v = s.variables.find((x) => x.id === o.variable);
          if (v && !v.values.some((x) => x.id === o.value))
            v.values.push({ id: o.value, provenance: [{ kind: 'owner', words: o.words, date: o.date }] });
        }
      return s;
    }),
  },
  {
    name: 'reader keeps the quote of a refused value out of the refusal',
    families: ['quotes'],
    make: buildWith((s) => {
      s.refused = [];
      return s;
    }),
  },
  {
    name: 'reader keeps a variable whose values were all refused',
    families: ['quotes'],
    make: buildWith((s, src) => {
      if (s.variables.length === 0 && src.estate?.rules.some((r) => r.tools.length > 0)) {
        const t = src.estate.rules.flatMap((r) => r.tools)[0];
        if (t) s.variables.push({ id: t.field, values: [] });
      }
      return s;
    }),
  },
  {
    name: 'reader changes the quote it keeps',
    families: ['quotes'],
    make: buildWith((s) => {
      for (const v of s.variables)
        for (const x of v.values)
          for (const p of x.provenance ?? [])
            if (p.kind === 'quote') p.quote = p.quote.replace(/\s+/g, ' ').trim().toLowerCase();
      return s;
    }),
  },
  {
    name: 'reader drops the span of a refused condition from the refusal',
    families: ['quotes'],
    make: buildWith((s) => {
      for (const r of s.refused) r.what = 'a condition';
      return s;
    }),
  },
  // ---- too strict: the product refuses or drops what the page accepts -------------------------------------
  {
    name: 'validate refuses every store',
    families: ['values', 'boundaries', 'weights', 'sources'],
    make: refuseIf(() => true),
  },
  {
    name: 'validate refuses a count equal to the total',
    families: ['sources'],
    make: refuseIf((v) => deepSome(v, (o) => o.kind === 'conversations' && o.count === o.total)),
  },
  {
    name: 'validate refuses a count of zero',
    families: ['sources'],
    make: refuseIf((v) => deepSome(v, (o) => o.kind === 'conversations' && o.count === 0)),
  },
  {
    name: 'validate refuses a quote of a thousand characters',
    families: ['sources'],
    make: refuseIf((v) =>
      deepSome(v, (o) => o.kind === 'quote' && typeof o.quote === 'string' && o.quote.length === 1000),
    ),
  },
  {
    name: 'validate refuses owner words of a thousand characters',
    families: ['sources'],
    make: refuseIf((v) =>
      deepSome(v, (o) => o.kind === 'owner' && typeof o.words === 'string' && o.words.length === 1000),
    ),
  },
  {
    name: 'validate refuses a leap day',
    families: ['sources'],
    make: refuseIf((v) => deepSome(v, (o) => o.kind === 'owner' && o.date === '2028-02-29')),
  },
  {
    name: 'validate refuses a structure entry',
    families: ['sources'],
    make: refuseIf((v) => deepSome(v, (o) => o.kind === 'structure')),
  },
  {
    name: 'validate refuses a ledger id',
    families: ['sources'],
    make: refuseIf((v) => deepSome(v, (o) => typeof o.ledger === 'string')),
  },
  {
    name: 'validate refuses the value none in two axes',
    families: ['values'],
    make: refuseIf((v) => JSON.stringify(v).split('"id":"none"').length > 2),
  },
  {
    name: 'validate refuses a value shared by an axis and a detail',
    families: ['values'],
    make: refuseIf((v) =>
      deepSome(v, (o) => o.role === 'detail' && Array.isArray(o.values) && o.kind === 'persona'),
    ),
  },
  {
    name: 'validate refuses a second channel that is a detail',
    families: ['values'],
    make: refuseIf((v) => deepSome(v, (o) => o.role === 'detail' && o.kind === 'channel')),
  },
  {
    name: 'validate refuses the twelve deviation classes',
    families: ['values'],
    make: refuseIf((v) =>
      deepSome(v, (o) => o.kind === 'deviation' && Array.isArray(o.values) && o.values.length > 6),
    ),
  },
  {
    name: 'validate refuses a detail of kind deviation',
    families: ['values'],
    make: refuseIf((v) => deepSome(v, (o) => o.kind === 'deviation' && o.role === 'detail')),
  },
  {
    name: 'validate refuses a when with known values',
    families: ['values'],
    make: refuseIf((v) => deepSome(v, (o) => typeof o.when === 'object' && o.when !== null)),
  },
  {
    name: 'validate refuses constraints that leave a cell',
    families: ['values'],
    make: refuseIf((v) => ((v as { constraints?: unknown[] }).constraints?.length ?? 0) >= 2),
  },
  {
    name: 'validate refuses a constraint on a detail',
    families: ['values'],
    make: refuseIf((v) =>
      JSON.stringify((v as { constraints?: unknown }).constraints ?? []).includes('under_two_days'),
    ),
  },
  {
    name: 'validate refuses a fitted prior with a source',
    families: ['values'],
    make: refuseIf((v) => deepSome(v, (o) => o.kind === 'fitted' && typeof o.source === 'string')),
  },
  {
    name: 'validate refuses ids with dots, underscores and hyphens',
    families: ['values'],
    make: refuseIf((v) =>
      deepSome(v, (o) => typeof o.id === 'string' && /[._-]/.test(o.id) && /^9/.test(o.id)),
    ),
  },
  {
    name: 'validate refuses a third value for the edge',
    families: ['boundaries'],
    make: refuseIf((v) =>
      deepSome(v, (o) => typeof o.edge === 'string' && o.edge !== o.holds && o.edge !== o.fails),
    ),
  },
  {
    name: 'validate refuses an edge on the holds side',
    families: ['boundaries'],
    make: refuseIf((v) => deepSome(v, (o) => typeof o.edge === 'string' && o.edge === o.holds)),
  },
  {
    name: 'validate refuses an edge on the fails side',
    families: ['boundaries'],
    make: refuseIf((v) => deepSome(v, (o) => typeof o.edge === 'string' && o.edge === o.fails)),
  },
  {
    name: 'validate refuses a limit that is zero, negative or fractional',
    families: ['boundaries'],
    make: refuseIf((v) =>
      deepSome(v, (o) => typeof o.limit === 'number' && (o.limit <= 0 || !Number.isInteger(o.limit))),
    ),
  },
  {
    name: 'validate refuses two boundaries on a variable',
    families: ['boundaries'],
    make: refuseIf((v) => deepSome(v, (o) => Array.isArray(o.boundaries) && o.boundaries.length > 1)),
  },
  {
    name: 'validate refuses weights that do not add up to one',
    families: ['weights'],
    make: refuseIf((v) =>
      deepSome(
        v,
        (o) =>
          Array.isArray(o.values) &&
          o.values.some(
            (x: unknown) =>
              typeof (x as { weight?: number }).weight === 'number' && (x as { weight: number }).weight > 1,
          ),
      ),
    ),
  },
  {
    name: 'validate refuses fractional weights',
    families: ['weights'],
    make: refuseIf((v) => deepSome(v, (o) => typeof o.weight === 'number' && o.weight < 1 && o.weight > 0)),
  },
  {
    name: 'validate refuses a weight of zero',
    families: ['weights'],
    make: refuseIf((v) => deepSome(v, (o) => o.weight === 0)),
  },
  {
    name: 'validate refuses weights on two variables',
    families: ['weights'],
    make: refuseIf(
      (v) =>
        (v as { variables?: Array<{ values: Array<{ weight?: number }> }> }).variables?.filter((x) =>
          x.values.some((y) => y.weight !== undefined),
        ).length === 2,
    ),
  },
  {
    name: 'validate accepts a weight written as text',
    families: ['weights'],
    make: dropErrors((c, p) => c === 'SCHEMA_INVALID_TYPE' && p.endsWith('.weight')),
  },
  {
    name: 'validate accepts a fractional or negative count',
    families: ['sources'],
    make: dropErrors(
      (c, p) =>
        (c === 'SCHEMA_INVALID_TYPE' || c === 'SCHEMA_TOO_SMALL') &&
        (p.endsWith('.count') || p.endsWith('.total')),
    ),
  },
  {
    name: 'validate accepts an empty quote',
    families: ['sources'],
    make: dropErrors((c, p) => (c === 'SCHEMA_TOO_SMALL' || c === 'SCHEMA_CUSTOM') && p.endsWith('.quote')),
  },
  {
    name: 'validate gives advice for a sourced entry',
    families: ['sources'],
    make: validateWith((r) =>
      r.ok
        ? { ...r, warnings: [...r.warnings, { code: 'VARIABLES_UNSOURCED', path: 'variables.2.values.0' }] }
        : r,
    ),
  },
  {
    name: 'quotes reports every quote',
    families: ['quotes'],
    make: (base) => ({
      impl: {
        ...base,
        quotes: (store) => {
          const errors: Array<{ code: string; path: string }> = [];
          const walk = (v: unknown, path: string): void => {
            if (Array.isArray(v)) {
              v.forEach((x, i) => {
                walk(x, `${path}.${i}`);
              });
            } else if (v && typeof v === 'object') {
              const o = v as Record<string, unknown>;
              if (o.kind === 'quote')
                errors.push({ code: 'VARIABLES_QUOTE_NOT_FOUND', path: `${path}.quote` });
              for (const [k, x] of Object.entries(o)) walk(x, path === '' ? k : `${path}.${k}`);
            }
          };
          walk(store, '');
          return { errors };
        },
      },
    }),
  },
  {
    name: 'quotes reports nothing',
    families: ['quotes'],
    make: (base) => ({ impl: { ...base, quotes: () => ({ errors: [] }) } }),
  },
  {
    name: 'quotes asks a file of conversation and owner evidence',
    families: ['quotes'],
    make: (base) => ({
      impl: {
        ...base,
        quotes: (store, files) => {
          const r = base.quotes(store, files);
          return deepSome(store, (o) => o.kind === 'conversations' || o.kind === 'owner')
            ? {
                errors: [
                  ...r.errors,
                  { code: 'VARIABLES_SOURCE_UNREADABLE', path: 'variables.2.values.0.provenance.0.path' },
                ],
              }
            : r;
        },
      },
    }),
  },
  {
    name: 'quotes compares the ledger id',
    families: ['quotes'],
    make: (base) => ({
      impl: {
        ...base,
        quotes: (store, files) => {
          const r = base.quotes(store, files);
          return deepSome(store, (o) => typeof o.ledger === 'string')
            ? {
                errors: [
                  ...r.errors,
                  { code: 'VARIABLES_QUOTE_NOT_FOUND', path: 'variables.2.values.0.provenance.0.quote' },
                ],
              }
            : r;
        },
      },
    }),
  },
  {
    name: 'quotes reports every structure entry',
    families: ['quotes'],
    make: (base) => ({
      impl: {
        ...base,
        quotes: (store, files) => {
          const r = base.quotes(store, files);
          return deepSome(store, (o) => o.kind === 'structure')
            ? {
                errors: [
                  ...r.errors,
                  { code: 'VARIABLES_HASH_MISMATCH', path: 'variables.2.values.0.provenance.0.hash' },
                ],
              }
            : r;
        },
      },
    }),
  },
  {
    name: 'quotes names an unresolved pointer a hash mismatch',
    families: ['quotes'],
    make: (base) => ({
      impl: {
        ...base,
        quotes: (...a) => ({
          errors: base
            .quotes(...a)
            .errors.map((e) =>
              e.code === 'VARIABLES_POINTER_UNRESOLVED'
                ? { code: 'VARIABLES_HASH_MISMATCH', path: e.path.replace(/\.(pointer|lines)$/, '.hash') }
                : e,
            ),
        }),
      },
    }),
  },
  {
    name: 'quotes accepts lines past the end',
    families: ['quotes'],
    make: (base) => ({
      impl: {
        ...base,
        quotes: (...a) => ({
          errors: base
            .quotes(...a)
            .errors.filter((e) => !(e.code === 'VARIABLES_POINTER_UNRESOLVED' && e.path.endsWith('.lines'))),
        }),
      },
    }),
  },
  {
    name: 'reader refuses a quote found twice in its file',
    families: ['quotes'],
    make: buildFrom((src) => {
      if (!src.estate) return src;
      for (const r of src.estate.rules)
        for (const t of r.tools)
          t.values = t.values.filter(
            (v) => (src.estate?.files[t.source] ?? '').split(v.quote).length - 1 < 2,
          );
      return src;
    }),
  },
  {
    name: 'reader ignores spans that are not a plain comparison',
    families: ['sources'],
    make: buildFrom((src) => {
      if (!src.estate) return src;
      for (const r of src.estate.rules)
        r.conditions = r.conditions.filter((c) => {
          const m = meaningOf(c.text);
          return m?.kind === 'numeric' && m.flavour === 'cmp';
        });
      return src;
    }),
  },
  {
    name: 'reader makes one variable for every rule that names a tool field',
    families: ['sources'],
    make: buildFrom((src) => {
      if (!src.estate) return src;
      for (const r of src.estate.rules) for (const t of r.tools) t.field = `${t.field}_${r.id}`;
      return src;
    }),
  },
  {
    name: 'reader merges tool fields by field name alone',
    families: ['sources'],
    make: buildFrom((src) => {
      if (!src.estate) return src;
      for (const r of src.estate.rules) for (const t of r.tools) t.tool = 'shared_tool';
      return src;
    }),
  },
  {
    name: 'reader drops the last rule',
    families: ['sources'],
    make: buildWith((s) => {
      s.rules.pop();
      return s;
    }),
  },
  {
    name: 'reader adds a variable for a rule with nothing in it',
    families: ['sources'],
    make: buildWith((s, src) => {
      for (const r of src.estate?.rules ?? [])
        if (r.conditions.length === 0 && r.tools.length === 0)
          s.variables.push({ id: r.id, values: [{ id: 'x', provenance: [] }] });
      return s;
    }),
  },
  {
    name: 'reader writes a conversation entry for no conversation',
    families: ['sources'],
    make: buildWith((s, src) => {
      if (src.conversations && src.conversations.length === 0)
        for (const x of s.variables.flatMap((v) => v.values))
          x.provenance = [
            ...(x.provenance ?? []),
            { kind: 'conversations', count: 0, total: 1, set_hash: '0'.repeat(64) },
          ];
      return s;
    }),
  },
  {
    name: 'reader counts conversations on variables no session showed',
    families: ['sources'],
    make: buildWith((s, src) => {
      if (src.conversations?.length)
        for (const x of s.variables.flatMap((v) => v.values))
          if (!x.provenance?.some((p) => p.kind === 'conversations'))
            x.provenance = [
              ...(x.provenance ?? []),
              { kind: 'conversations', count: 0, total: src.conversations.length, set_hash: '0'.repeat(64) },
            ];
      return s;
    }),
  },
  {
    name: 'reader creates the variable the owner names',
    families: ['values'],
    make: buildWith((s, src) => {
      for (const o of src.owner?.values ?? [])
        if (!s.variables.some((v) => v.id === o.variable))
          s.variables.push({
            id: o.variable,
            values: [{ id: o.value, provenance: [{ kind: 'owner', words: o.words, date: o.date }] }],
          });
      return s;
    }),
  },
  {
    name: 'reader keeps raw field names as ids',
    families: ['values'],
    make: buildWith((s) => {
      for (const v of s.variables) if (v.title) v.id = v.title.split(' of ')[0] as string;
      return s;
    }),
  },
  {
    name: 'reader merges variables that share value ids',
    families: ['values'],
    make: buildWith((s) => {
      const seen = new Map<string, StoreDoc['variables'][number]>();
      s.variables = s.variables.filter((v) => {
        const key = v.values.map((x) => x.id).join(',');
        const prior = seen.get(key);
        if (prior) return false;
        seen.set(key, v);
        return true;
      });
      return s;
    }),
  },
  {
    name: 'reader derives a numeric id from the raw text',
    families: ['values'],
    make: buildWith((s) => {
      for (const v of s.variables) {
        const q = v.values[0]?.provenance?.find((p) => p.kind === 'quote');
        if (q?.kind === 'quote' && v.values.some((x) => typeof x.sample === 'number'))
          v.id = sha(q.quote).slice(0, 12);
      }
      return s;
    }),
  },
  {
    name: 'reader drops the path of a quote',
    families: ['boundaries'],
    make: buildWith((s) => {
      for (const v of s.variables)
        for (const x of v.values) for (const p of x.provenance ?? []) if (p.kind === 'quote') p.path = '';
      return s;
    }),
  },
  {
    name: 'reader accepts any owner pair',
    families: ['impossible-pairs'],
    make: buildWith((s, src) => {
      for (const p of src.owner?.impossible ?? [])
        if (!s.impossible.some((q) => JSON.stringify(q.a) === JSON.stringify(p.a)))
          s.impossible.push({
            a: p.a,
            b: p.b,
            provenance: [{ kind: 'owner', words: p.words, date: p.date }],
          });
      return s;
    }),
  },
  {
    name: 'reader drops the provenance of an owner pair',
    families: ['impossible-pairs'],
    make: buildWith((s) => {
      for (const p of s.impossible) p.provenance = [];
      return s;
    }),
  },
  {
    name: 'reader creates the value an owner weight names',
    families: ['weights'],
    make: buildWith((s, src) => {
      for (const o of src.owner?.weights ?? []) {
        const v = s.variables.find((x) => x.id === o.variable);
        if (v && !v.values.some((x) => x.id === o.value))
          v.values.push({ id: o.value, weight: o.weight, provenance: [] });
      }
      return s;
    }),
  },
  {
    name: 'plan uses what nobody approved',
    families: ['values', 'impossible-pairs'],
    make: planFrom((store, o) => {
      for (const v of store.variables) {
        delete v.approved;
        for (const x of v.values) delete x.approved;
      }
      for (const f of store.forbids ?? []) delete f.approved;
      return [store, o];
    }),
  },
  {
    name: 'plan reads the order of a pair',
    families: ['impossible-pairs'],
    make: planWith((p, store) => {
      const tag = sha(JSON.stringify(store.impossible)).slice(0, 6);
      for (const r of p.rows) r.id = `${r.id}.${tag}`;
      return p;
    }),
  },
  {
    name: 'plan warns that a value is unreachable when none is',
    families: ['impossible-pairs'],
    make: planWith((p) => {
      p.warnings = [...(p.warnings ?? []), { code: 'value_unreachable', message: 'a value cannot be held' }];
      return p;
    }),
  },
  {
    name: 'plan shares the seed objects',
    families: ['seed-rows'],
    make: (base) => ({
      impl: {
        ...base,
        plan: (store, o) => {
          const out = base.plan(store, o);
          (o.seeds ?? []).forEach((seed, i) => {
            if (out.rows[i]?.kind === 'seed') (out.rows[i] as { values: Row }).values = seed;
          });
          return out;
        },
      },
    }),
  },
  {
    name: 'plan warns about every seed',
    families: ['seed-rows'],
    make: planWith((p, _s, o) => {
      if ((o.seeds ?? []).length > 0)
        p.warnings = [...(p.warnings ?? []), { code: 'seed_unknown_value', message: 'a seed' }];
      return p;
    }),
  },
  {
    name: 'plan writes ten places',
    families: ['budget-order'],
    make: planWith((p) => {
      for (const r of p.rows) if (r.logWeight !== null) r.logWeight += 2e-11;
      return p;
    }),
  },
  {
    name: 'plan orders seeds by weight',
    families: ['budget-order'],
    make: planWith((p) => {
      p.rows.sort(
        (a, b) => (b.logWeight ?? Number.NEGATIVE_INFINITY) - (a.logWeight ?? Number.NEGATIVE_INFINITY),
      );
      return p;
    }),
  },
  {
    name: 'plan reads a zero budget as no budget',
    families: ['budget-order'],
    make: (base) => ({
      impl: {
        ...base,
        plan: (store, o) => base.plan(store, o.budget === 0 ? { ...o, budget: undefined } : o),
      },
    }),
  },
  {
    name: 'plan breaks on one seed',
    families: ['budget-order'],
    make: (base) => ({
      impl: {
        ...base,
        plan: (store, o) => {
          const out = base.plan(store, o);
          if (o.seed === 3) out.rows.reverse();
          return out;
        },
      },
    }),
  },
  {
    name: 'coverage returns zero',
    families: ['counter'],
    make: (base) => ({ impl: { ...base, coverage: () => ({ allowed: 0, covered: 0 }) } }),
  },
  {
    name: 'coverage lists a tuple twice',
    families: ['counter'],
    make: (base) => ({
      impl: {
        ...base,
        coverage: (...a) => {
          const r = base.coverage(...a);
          if (r.uncovered && r.uncovered.length > 1)
            r.uncovered = [r.uncovered[0] as Row, ...r.uncovered.slice(0, -1)];
          return r;
        },
      },
    }),
  },
  {
    name: 'interval is shifted on the lower bound',
    families: ['weights'],
    make: (base) => ({
      impl: {
        ...base,
        weightInterval: (c, n) => {
          const [lo, hi] = base.weightInterval(c, n);
          return [Math.max(0, lo - 0.001), hi];
        },
      },
    }),
  },
  {
    name: 'interval is off for large totals',
    families: ['weights'],
    make: (base) => ({
      impl: { ...base, weightInterval: (c, n) => (n > 1e5 ? [0, 1] : base.weightInterval(c, n)) },
    }),
  },
  {
    name: 'plan is slow',
    families: ['scale'],
    only: ['scale.axes.binary-20'],
    make: (base) => ({
      impl: {
        ...base,
        plan: (store, o) => {
          const t0 = process.cpuUsage();
          while ((process.cpuUsage(t0).user + process.cpuUsage(t0).system) / 1000 < 5200) {
            /* spin */
          }
          return base.plan(store, o);
        },
      },
    }),
  },
  {
    name: 'plan emits too many rows',
    families: ['scale'],
    only: ['scale.axes.binary-50'],
    make: planWith((p) => {
      const fresh = p.rows.filter((r) => r.kind === 'new');
      for (let k = 0; k < 4; k += 1) p.rows.push(...fresh.map((r) => ({ ...copy(r), id: `${r.id}.${k}` })));
      return p;
    }),
  },
  {
    name: 'plan leaves out a pair of axes at scale',
    families: ['scale'],
    only: ['scale.axes.ternary-30'],
    make: planWith((p) => {
      const i = p.rows.map((r) => r.kind).lastIndexOf('new');
      if (i >= 0) p.rows.splice(i, 3);
      return p;
    }),
  },
  {
    name: 'coverage is slow in closed form',
    families: ['scale'],
    only: ['scale.counter.closed-form-200-binary'],
    make: (base) => ({
      impl: {
        ...base,
        coverage: (...a) => {
          const t0 = process.cpuUsage();
          while ((process.cpuUsage(t0).user + process.cpuUsage(t0).system) / 1000 < 200) {
            /* spin */
          }
          return base.coverage(...a);
        },
      },
    }),
  },
  {
    name: 'quotes is slow on a large file',
    families: ['scale'],
    only: ['scale.readers.quotes-2000-in-one-megabyte'],
    make: (base) => ({
      impl: {
        ...base,
        quotes: (...a) => {
          const t0 = process.cpuUsage();
          while ((process.cpuUsage(t0).user + process.cpuUsage(t0).system) / 1000 < 3200) {
            /* spin */
          }
          return base.quotes(...a);
        },
      },
    }),
  },
  {
    name: 'reader is slow on many conversations',
    families: ['scale'],
    only: ['scale.readers.conversations-10000'],
    make: (base) => ({
      impl: {
        ...base,
        buildStore: (s) => {
          const t0 = process.cpuUsage();
          while ((process.cpuUsage(t0).user + process.cpuUsage(t0).system) / 1000 < 2300) {
            /* spin */
          }
          return base.buildStore(s);
        },
      },
    }),
  },
  {
    name: 'reader loses conversation counts at scale',
    families: ['scale'],
    only: ['scale.readers.conversations-10000'],
    make: buildWith((s) => {
      for (const x of s.variables.flatMap((v) => v.values))
        for (const p of x.provenance ?? []) if (p.kind === 'conversations') p.count += 1;
      return s;
    }),
  },
  {
    name: 'plan ignores the impossible pairs at scale',
    families: ['scale'],
    only: ['scale.dense-pairs.two-thousand-pairs'],
    make: planFrom((store, o) => {
      store.impossible = [];
      return [store, o];
    }),
  },
  {
    name: 'plan drops its last new row at scale',
    families: ['scale'],
    make: planWith((p) => {
      const i = p.rows.map((r) => r.kind).lastIndexOf('new');
      if (i >= 0) p.rows.splice(i, 1);
      return p;
    }),
    only: [
      'scale.axes.binary-100',
      'scale.axes.binary-200',
      'scale.axes.binary-400',
      'scale.axes.ternary-60',
      'scale.axes.arity-eight-10',
      'scale.axes.arity-eight-20',
      'scale.axes.one-arity-200-axis-and-three-binary',
      'scale.rules.twenty-rules',
      'scale.rules.hundred-rules',
      'scale.rules.overlapping-rules',
      'scale.details.thousand-ternary',
      'scale.details.five-thousand-ternary',
      'scale.dense-pairs.two-thousand-pairs',
      'scale.dense-pairs.twenty-thousand-pairs',
      'scale.axes.binary-20',
      'scale.axes.binary-50',
      'scale.axes.ternary-30',
    ],
  },
  {
    name: 'plan adds a row when the seeds hold everything',
    families: ['scale'],
    only: ['scale.seeds.five-hundred-seeds', 'scale.seeds.three-thousand-seeds'],
    make: planWith((p) => {
      const last = p.rows[p.rows.length - 1];
      if (last) p.rows.push({ ...copy(last), id: 'extra', kind: 'new' });
      return p;
    }),
  },
  {
    name: 'reader drops its last variable at scale',
    families: ['scale'],
    only: [
      'scale.readers.spans-200',
      'scale.readers.spans-2000',
      'scale.readers.spans-10000',
      'scale.readers.conversations-10000',
      'scale.readers.conversations-100000',
      'scale.readers.owner-values-2000',
      'scale.readers.owner-values-10000',
    ],
    make: buildWith((s) => {
      s.variables.pop();
      return s;
    }),
  },
  {
    name: 'quotes reports one error too few at scale',
    families: ['scale'],
    only: ['scale.readers.quotes-2000-in-one-megabyte'],
    make: (base) => ({
      impl: { ...base, quotes: (...a) => ({ errors: base.quotes(...a).errors.slice(1) }) },
    }),
  },
  {
    name: 'coverage is off by one at scale',
    families: ['scale'],
    only: [
      'scale.counter.closed-form-200-binary',
      'scale.counter.closed-form-500-binary',
      'scale.counter.thirty-rows-100-binary-strength-3',
      'scale.counter.thirty-rows-200-binary-strength-2',
    ],
    make: (base) => ({
      impl: {
        ...base,
        coverage: (...a) => {
          const r = base.coverage(...a);
          return { ...r, allowed: BigInt(r.allowed) + 1n, covered: BigInt(r.covered) + 1n };
        },
      },
    }),
  },
];
