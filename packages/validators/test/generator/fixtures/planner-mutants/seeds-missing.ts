import { planted } from './wrap';

// The plan returns its new rows only, though seeds were given: fewer rows lead than seeds.
export const planV2 = planted((plan) => ({
  ...plan,
  rows: plan.rows.filter((row) => row.source !== 'seed'),
}));
