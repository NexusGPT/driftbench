import { planted } from './wrap';

// A variable with no weights is taken as weight 1 per value, so it adds nothing to a row's weight.
export const planV2 = planted((plan, store) => {
  const unweighted = new Set(
    store.variables
      .filter((variable) => variable.values.every((value) => value.weight === undefined))
      .map((variable) => variable.id),
  );
  const share = (id: string) => {
    const variable = store.variables.find((entry) => entry.id === id);
    return variable ? Math.log(1 / variable.values.filter((value) => value.approved ?? variable.approved).length) : 0;
  };
  return {
    ...plan,
    rows: plan.rows.map((row) =>
      row.source === 'planned'
        ? {
            ...row,
            logWeight: Object.keys(row.values).reduce(
              (sum, id) => (unweighted.has(id) ? sum - share(id) : sum),
              row.logWeight,
            ),
          }
        : row,
    ),
  };
});
