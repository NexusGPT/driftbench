import { planted } from './wrap';

// A call without a budget is planned as a call with a budget of zero: no new row, and a report that agrees with it.
export const planV2 = planted(
  (plan) => plan,
  (options) => ({ ...options, budget: options.budget ?? 0 }),
);
