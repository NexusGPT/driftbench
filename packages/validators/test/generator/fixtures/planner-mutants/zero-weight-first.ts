import { planted } from './wrap';

export { renderPlanV2 } from '@agent-nexus/driftbench-generate';

// Rows that weigh minus infinity come first among the new rows.
export const planV2 = planted((plan) => {
  const planned = plan.rows.filter((row) => row.source === 'planned');
  const zero = planned.filter((row) => row.logWeight === Number.NEGATIVE_INFINITY);
  const rest = planned.filter((row) => row.logWeight !== Number.NEGATIVE_INFINITY);
  return { ...plan, rows: [...plan.rows.filter((row) => row.source === 'seed'), ...zero, ...rest] };
});
