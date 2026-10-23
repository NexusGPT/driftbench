import { planted } from './wrap';

// The review's mutant: a seed row that sets only some variables gets the id `seed.wrong-N`; its values, the order
// and the report stay as they are.
export const planV2 = planted((plan, store) => {
  const approved = store.variables.filter((variable) => variable.approved).length;
  let n = 0;
  return {
    ...plan,
    rows: plan.rows.map((row) =>
      row.source === 'seed' && Object.keys(row.values).length < approved
        ? { ...row, id: `seed.wrong-${n++}` }
        : row,
    ),
  };
});
