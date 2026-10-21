import { planted } from './wrap';

// A seed that names an unknown value is dropped.
export const planV2 = planted((plan) => ({
  ...plan,
  rows: plan.rows.filter(
    (row) =>
      row.source !== 'seed' ||
      plan.warnings.every((w) => w.code !== 'seed_unknown_value' || !row.id.endsWith(w.seed)),
  ),
}));
