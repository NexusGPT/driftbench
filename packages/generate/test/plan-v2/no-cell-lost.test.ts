import { fileURLToPath } from 'node:url';
import {
  cells,
  loadVariableStore,
  type Cell as OldCell,
  variablesToSpaceMap,
} from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { planV2 } from '../../src/plan-v2';
import { feasibleTuples, holds, validCells } from './helpers';

/**
 * The cells of the planner of the seeders against the rows of planner v2, on the worked stores of
 * examples/variables. The current planner (`cells` of the space package) asks for every allowed combination of
 * values on every set of t axes of the store's approved space map. Planner v2 asks for strength 3 on the
 * variables of a rule, 2 on shared axes and 1 elsewhere. So a cell of the current plan that v2 does not hold is
 * not a defect by itself: each one is named below by the reason it is lost, and a cell lost for a reason that
 * would be a defect (it sits inside a rule, or a value the old plan covered at strength 1) is none.
 */

const example = (name: string) =>
  fileURLToPath(new URL(`../../../../examples/variables/${name}.yaml`, import.meta.url));

type Reason =
  | 'inside_rule'
  | 'store_forbidden'
  | 'value_unreachable'
  | 'infeasible_in_a_row'
  | 'outside_rules';

/** Per example and strength: the cells of the current plan, and how many v2 loses, by reason. Counts of the pull request. */
const EXPECTED: Record<string, Record<number, { old: number; lost: Partial<Record<Reason, number>> }>> = {
  acme: {
    1: { old: 11, lost: {} },
    2: { old: 43, lost: { outside_rules: 21 } },
    3: { old: 69, lost: { outside_rules: 53 } },
  },
  northwind: {
    1: { old: 12, lost: {} },
    2: { old: 33, lost: { outside_rules: 27 } },
  },
};

async function load(name: string) {
  const loaded = await loadVariableStore(example(name));
  if (!loaded.ok) throw new Error(loaded.errors.map((issue) => issue.message).join('\n'));
  const mapped = variablesToSpaceMap(loaded.store);
  if (!mapped.ok) throw new Error(mapped.errors.map((issue) => issue.message).join('\n'));
  return { store: loaded.store, map: mapped.map };
}

describe.each(Object.keys(EXPECTED))(
  'the %s plan: the cells of the current planner that v2 does not hold',
  (name) => {
    async function ledger(t: number) {
      const { store, map } = await load(name);
      const plan = planV2(store, { seed: 1 });
      const valid = validCells(store);
      const rules = plan.rules.map((rule) => new Set(rule.variables));
      const unreachable = new Set(
        plan.warnings.flatMap((warning) =>
          warning.code === 'value_unreachable' ? [`${warning.variable}=${warning.value}`] : [],
        ),
      );
      const old: OldCell[] = cells(map, { t });
      const lost: Array<{ cell: OldCell; reason: Reason }> = [];
      for (const cell of old) {
        if (plan.rows.some((row) => holds(row.values, cell.values))) continue;
        const variables = Object.keys(cell.values);
        const reason: Reason = Object.entries(cell.values).some(([v, value]) =>
          unreachable.has(`${v}=${value}`),
        )
          ? 'value_unreachable'
          : !feasibleTuples(valid, variables).some((tuple) => holds(tuple, cell.values))
            ? 'infeasible_in_a_row'
            : rules.some((rule) => variables.every((variable) => rule.has(variable)))
              ? 'inside_rule'
              : 'outside_rules';
        lost.push({ cell, reason });
      }
      return { old, lost, plan };
    }

    const strengths = Object.keys(EXPECTED[name] ?? {}).map(Number);

    it.each(strengths)(
      'at strength %i, loses only the cells it names, and none that sit inside a rule',
      async (t) => {
        const { old, lost } = await ledger(t);
        const want = EXPECTED[name]?.[t];
        expect(old).toHaveLength(want?.old ?? -1);
        const byReason: Partial<Record<Reason, number>> = {};
        for (const { reason } of lost) byReason[reason] = (byReason[reason] ?? 0) + 1;
        expect(byReason).toEqual(want?.lost);
        expect(lost.filter(({ reason }) => reason === 'inside_rule' || reason === 'store_forbidden')).toEqual(
          [],
        );
      },
    );

    it('holds every value the current planner asks for at strength 1, but the ones it names unreachable', async () => {
      const { lost } = await ledger(1);
      expect(lost.filter(({ reason }) => reason !== 'value_unreachable')).toEqual([]);
    });

    it('loses, at every strength, a cell only for a reason that names the variables it joins', async () => {
      for (const t of strengths) {
        const { store } = await load(name);
        const rules = planV2(store, { seed: 1 }).rules.map((rule) => new Set(rule.variables));
        const { lost } = await ledger(t);
        for (const { cell, reason } of lost) {
          if (reason !== 'outside_rules') continue;
          const variables = Object.keys(cell.values);
          // No rule names every variable of the cell: the layer that covers it is strength 1 by design.
          expect(rules.some((rule) => variables.every((variable) => rule.has(variable)))).toBe(false);
        }
      }
    });
  },
);
