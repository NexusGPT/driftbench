import { planted } from './wrap';

// A budget of every new row or more still cuts the last one.
export const planV2 = planted((plan, _store, options) => {
  if (options.budget === undefined || options.budget < plan.generated) return plan;
  return { ...plan, cut: plan.cut + 1, rows: plan.rows.slice(0, -1) };
});
