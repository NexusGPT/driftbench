import { planted } from './wrap';

// A row weighs the sum of the logarithms of the raw weights of its values, not of their shares.
export const planV2 = planted((plan, store) => {
  const weightOf = (variable: string, value: string) =>
    store.variables.find((entry) => entry.id === variable)?.values.find((entry) => entry.id === value)
      ?.weight ?? 1;
  return {
    ...plan,
    rows: plan.rows.map((row) =>
      row.source === 'planned'
        ? {
            ...row,
            logWeight: Object.entries(row.values).reduce((sum, [k, v]) => sum + Math.log(weightOf(k, v)), 0),
          }
        : row,
    ),
  };
});
