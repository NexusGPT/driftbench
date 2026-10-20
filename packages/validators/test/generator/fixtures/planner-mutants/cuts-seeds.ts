import { planted } from './wrap';

// A budget cuts seed rows too.
export const planV2 = planted((plan, _store, options) =>
  options.budget === undefined ? plan : { ...plan, rows: plan.rows.slice(0, options.budget) },
);
