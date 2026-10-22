import { planted } from './wrap';

// A seed row that holds a value nobody approved gets the id `seed.wrong`; its values and the report stay.
export const planV2 = planted((plan, store) => {
  const approved = (variable: string, value: string) => {
    const found = store.variables.find((entry) => entry.id === variable);
    const at = found?.values.find((entry) => entry.id === value);
    return found !== undefined && at !== undefined && (at.approved ?? found.approved);
  };
  return {
    ...plan,
    rows: plan.rows.map((row) =>
      row.source === 'seed' && Object.entries(row.values).some(([k, v]) => !approved(k, v))
        ? { ...row, id: 'seed.wrong' }
        : row,
    ),
  };
});
