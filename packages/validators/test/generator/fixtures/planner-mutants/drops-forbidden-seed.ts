import { planted } from './wrap';

// A seed that holds a forbidden combination is dropped, and so is its warning.
export const planV2 = planted((plan) => {
  const dropped = new Set(
    plan.warnings.flatMap((warning) => (warning.code === 'seed_forbidden' ? [`seed.${warning.seed}`] : [])),
  );
  return {
    ...plan,
    rows: plan.rows.filter((row) => !dropped.has(row.id)),
    warnings: plan.warnings.filter((warning) => warning.code !== 'seed_forbidden'),
  };
});
