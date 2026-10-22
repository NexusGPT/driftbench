import { planted } from './wrap';

export { renderPlanV2 } from '@agent-nexus/driftbench-generate';

// The review's mutant: rows at minus infinity stay, and every finite weight of a new row becomes 999.
export const planV2 = planted((plan) => ({
  ...plan,
  rows: plan.rows.map((row) =>
    row.source === 'planned' && Number.isFinite(row.logWeight) ? { ...row, logWeight: 999 } : row,
  ),
}));
