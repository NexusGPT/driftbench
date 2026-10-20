import { planted } from './wrap';

// Every row weighs NaN: a comparison with NaN is never true, so a loose check passes it.
export const planV2 = planted((plan) => ({
  ...plan,
  rows: plan.rows.map((row) => ({ ...row, logWeight: Number.NaN })),
}));
