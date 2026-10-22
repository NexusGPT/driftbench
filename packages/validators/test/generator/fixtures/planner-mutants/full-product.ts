import { planted } from './wrap';

// Every combination of the approved values is a new row: far more rows than any strength asks for.
export const planV2 = planted((plan, store) => {
  const variables = store.variables
    .filter((variable) => variable.approved)
    .map((variable) => ({
      id: variable.id,
      values: variable.values.filter((value) => value.approved ?? variable.approved).map((value) => value.id),
    }));
  const cells = variables.reduce<Record<string, string>[]>(
    (rows, variable) =>
      rows.flatMap((row) => variable.values.map((value) => ({ ...row, [variable.id]: value }))),
    [{}],
  );
  const width = Math.max(3, String(cells.length).length);
  const planned = cells.map((values, at) => ({
    id: `row.${String(at + 1).padStart(width, '0')}`,
    source: 'planned' as const,
    values,
    logWeight: 0,
  }));
  return {
    ...plan,
    generated: planned.length,
    rows: [...plan.rows.filter((row) => row.source === 'seed'), ...planned],
  };
});
