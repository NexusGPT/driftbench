import { type PlanV2, planV2 as real } from '@agent-nexus/driftbench-generate';

type Store = Parameters<typeof real>[0];
type Options = NonNullable<Parameters<typeof real>[1]>;

/**
 * The order and the warning docs/variables.md asks for (Values, R9), built on the real planner: in the plan without
 * a budget the new rows that hold a required value come first, then the rest, each group from the most common; a
 * budget keeps a prefix of that plan and warns budget_drops_required for each required value it left in no row.
 * `order` and `warn` let a planted fault undo one part.
 */
export function requiredFirst(order: 'first' | 'last' = 'first', warn = true) {
  return (store: Store, options: Options = {}): PlanV2 => {
    const { budget, ...rest } = options;
    const whole = real(store, rest);
    const cut = budget === undefined ? whole : real(store, options);
    const required = store.variables.flatMap((variable) =>
      variable.values.filter((value) => value.required === true).map((value) => [variable.id, value.id] as const),
    );
    const holds = (row: PlanV2['rows'][number]) => required.some(([k, v]) => row.values[k] === v);
    const seeds = whole.rows.filter((row) => row.source === 'seed');
    const planned = whole.rows.filter((row) => row.source === 'planned');
    const lead = planned.filter(holds);
    const tail = planned.filter((row) => !holds(row));
    const ordered = order === 'first' ? [...lead, ...tail] : [...tail, ...lead];
    const width = Math.max(3, String(ordered.length).length);
    const numbered = ordered.map((row, at) => ({ ...row, id: `row.${String(at + 1).padStart(width, '0')}` }));
    const room = budget === undefined ? numbered.length : Math.max(0, budget - seeds.length);
    const rows = [...seeds, ...numbered.slice(0, room)];
    const dropped = required.filter(
      ([k, v]) => numbered.some((row) => row.values[k] === v) && !rows.some((row) => row.values[k] === v),
    );
    const warning = {
      code: 'budget_drops_required',
      values: dropped.map(([variable, value]) => ({ variable, value })),
      message: `the budget leaves ${dropped.length} required values in no row`,
    };
    return {
      ...cut,
      generated: numbered.length,
      cut: numbered.length - (rows.length - seeds.length),
      rows,
      warnings: [
        ...cut.warnings,
        ...(warn && dropped.length > 0 ? [warning as unknown as PlanV2['warnings'][number]] : []),
      ],
    };
  };
}

export const planV2 = requiredFirst();
