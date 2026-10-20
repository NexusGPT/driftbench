import { planted } from './wrap';

// Every row weighs the same.
export const planV2 = planted((plan) => ({
  ...plan,
  rows: plan.rows.map((row) => ({ ...row, logWeight: 0 })),
}));
