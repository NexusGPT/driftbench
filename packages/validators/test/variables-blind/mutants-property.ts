import type { Plan, PlanOptions, StoreDoc } from '../../src/ladders/variables/interface';
import type { Mutant } from './mutants';

/**
 * Mutants of the reference for the differential property items (blind/families/property.ts): one wrong behaviour
 * each, written as a change to the store or the plan the reference sees, so no switch inside the reference is
 * needed. Each mutant names the items it must make fail.
 */

const copy = <T>(x: T): T => structuredClone(x);

const storeChange =
  (change: (store: StoreDoc) => void): Mutant['make'] =>
  (base) => ({
    impl: {
      ...base,
      plan: (store, options) => {
        const changed = copy(store);
        change(changed);
        return base.plan(changed, options);
      },
    },
  });

const planChange =
  (change: (plan: Plan, store: StoreDoc, options: PlanOptions) => void): Mutant['make'] =>
  (base) => ({
    impl: {
      ...base,
      plan: (store, options) => {
        const plan = copy(base.plan(store, options));
        change(plan, store, options);
        return plan;
      },
    },
  });

export const PROPERTY_MUTANTS: readonly Mutant[] = [
  {
    name: 'plan reads a three-entry forbid as its first two entries',
    families: ['strength'],
    only: ['three-entry-forbid-inside-a-rule'],
    make: storeChange((store) => {
      for (const f of store.forbids ?? []) {
        const keep = Object.entries(f.forbid).slice(0, 2);
        f.forbid = Object.fromEntries(keep);
      }
    }),
  },
  {
    name: 'plan never warns that a value is unreachable',
    families: ['strength'],
    only: ['unreachable-value-is-warned-and-the-rest-is-covered'],
    make: planChange((plan) => {
      plan.warnings = (plan.warnings ?? []).filter((w) => w.code !== 'value_unreachable');
    }),
  },
  {
    name: 'plan forgets the second of two chained impossible pairs',
    families: ['strength', 'counter'],
    only: ['pairwise-fine-tuple-that-no-row-holds', 'pairwise-fine-tuple-is-not-counted'],
    make: storeChange((store) => {
      store.impossible = store.impossible.slice(0, 1);
    }),
  },
  {
    name: 'plan plans values nobody approved',
    families: ['strength', 'seed-rows'],
    only: ['unapproved-value-in-a-rule', 'seed-with-an-unapproved-value-is-kept-warned-and-credits-nothing'],
    make: storeChange((store) => {
      for (const v of store.variables) for (const x of v.values) delete x.approved;
    }),
  },
  {
    name: 'plan plans variables nobody approved',
    families: ['strength'],
    only: ['unapproved-variable-is-no-axis'],
    make: storeChange((store) => {
      for (const v of store.variables) delete v.approved;
    }),
  },
  {
    name: 'plan applies a forbid nobody approved',
    families: ['strength'],
    only: ['unapproved-forbid-plans-nothing'],
    make: storeChange((store) => {
      for (const f of store.forbids ?? []) f.approved = true;
    }),
  },
  {
    name: 'plan crosses only the first of two rules',
    families: ['strength', 'counter'],
    only: ['two-rules-share-a-variable-beside-a-pair', 'two-rules-with-a-pair'],
    make: storeChange((store) => {
      store.rules = store.rules.slice(0, 1);
    }),
  },
  {
    name: 'plan lets a pair of one variable exclude a value',
    families: ['strength'],
    only: ['a-pair-of-one-variable-beside-a-real-forbid'],
    make: storeChange((store) => {
      for (const p of store.impossible) {
        if (p.a.variable === p.b.variable) {
          store.forbids = [...(store.forbids ?? []), { forbid: { [p.a.variable]: p.a.value } }];
        }
      }
    }),
  },
  {
    name: 'plan leaves out the cell of a rule of two that a forbid removes',
    families: ['strength'],
    only: ['rule-of-two-with-a-forbidden-cell'],
    make: storeChange((store) => {
      for (const f of store.forbids ?? []) {
        const [first] = Object.entries(f.forbid);
        if (first) f.forbid = Object.fromEntries([first]);
      }
    }),
  },
  {
    name: 'plan counts a partial seed as a full row',
    families: ['seed-rows', 'counter'],
    only: ['partial-seeds-beside-a-forbid', 'partial-seeds-and-an-unapproved-value'],
    make: planChange((plan) => {
      for (const row of plan.rows) {
        if (row.kind === 'seed') {
          const filled = Object.keys(row.values).length;
          if (filled > 0 && plan.report) plan.report.covered = Number(plan.report.covered) + filled;
        }
      }
    }),
  },
  {
    name: 'plan adds a new row after seeds that hold every valid row',
    families: ['seed-rows'],
    only: ['seeds-that-cover-everything-leave-no-new-rows'],
    make: planChange((plan) => {
      const last = plan.rows[plan.rows.length - 1];
      if (last && last.kind === 'seed') {
        plan.rows.push({ id: 'extra.1', kind: 'new', values: { ...last.values }, logWeight: last.logWeight });
      }
    }),
  },
  {
    name: 'plan writes a raw weight where a share belongs',
    families: ['budget-order'],
    only: ['scaling-the-weights-of-a-variable-changes-nothing', 'unweighted-variables-beside-a-weighted-one-share-uniformly'],
    make: planChange((plan, store) => {
      for (const row of plan.rows) {
        if (row.kind !== 'new') continue;
        let total = 0;
        for (const v of store.variables) {
          const value = v.values.find((x) => x.id === row.values[v.id]);
          total += Math.log(value?.weight ?? 1);
        }
        row.logWeight = Number.isFinite(total) ? Number(total.toFixed(9)) : null;
      }
    }),
  },
  {
    name: 'plan puts a zero-weight row before the common rows',
    families: ['budget-order'],
    only: ['zero-weight-rows-come-last'],
    make: planChange((plan) => {
      const fresh = plan.rows.filter((r) => r.kind === 'new');
      const nulls = fresh.filter((r) => r.logWeight === null);
      const others = fresh.filter((r) => r.logWeight !== null);
      const seeds = plan.rows.filter((r) => r.kind === 'seed');
      plan.rows = [...seeds, ...nulls, ...others];
    }),
  },
  {
    name: 'plan cuts a budget by dropping the most common new row',
    families: ['budget-order'],
    only: ['budget-keeps-a-prefix-beside-seeds-and-a-forbid'],
    make: planChange((plan, _store, options) => {
      if (options.budget !== undefined) {
        const i = plan.rows.findIndex((r) => r.kind === 'new');
        if (i >= 0) plan.rows.splice(i, 1);
      }
    }),
  },
];
