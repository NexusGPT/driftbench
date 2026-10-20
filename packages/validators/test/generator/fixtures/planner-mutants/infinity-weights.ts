import { planted } from './wrap';

// Every row weighs plus infinity.
export const planV2 = planted((plan) => ({
  ...plan,
  rows: plan.rows.map((row) => ({ ...row, logWeight: Number.POSITIVE_INFINITY })),
}));
