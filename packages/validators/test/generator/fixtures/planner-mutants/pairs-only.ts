import { planted } from './wrap';

// Rows stop after half the plan: strength 3 is lost.
export const planV2 = planted((plan) => {
  const planned = plan.rows.filter((row) => row.source === 'planned');
  const keep = new Set(planned.slice(0, Math.ceil(planned.length / 2)));
  return { ...plan, rows: plan.rows.filter((row) => row.source === 'seed' || keep.has(row)) };
});
