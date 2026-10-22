import { planted } from './wrap';

// A seed's entry that names a value nobody approved is left out of the seed row.
export const planV2 = planted((plan, store) => {
  const approved = (variable: string, value: string) => {
    const found = store.variables.find((entry) => entry.id === variable);
    const at = found?.values.find((entry) => entry.id === value);
    return found !== undefined && at !== undefined && (at.approved ?? found.approved);
  };
  return {
    ...plan,
    rows: plan.rows.map((row) =>
      row.source === 'seed'
        ? {
            ...row,
            values: Object.fromEntries(Object.entries(row.values).filter(([k, v]) => approved(k, v))),
          }
        : row,
    ),
  };
});
