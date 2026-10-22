import { planted } from './wrap';

// The new rows run in reverse when the first key of the store's first variable sorts after its last key: the plan
// follows the order the keys are written in.
export const planV2 = planted((plan, store) => {
  const keys = Object.keys(store.variables[0] ?? {});
  if (keys.length < 2 || (keys[0] as string) < (keys.at(-1) as string)) return plan;
  const planned = plan.rows.filter((row) => row.source === 'planned').reverse();
  return { ...plan, rows: [...plan.rows.filter((row) => row.source === 'seed'), ...planned] };
});
