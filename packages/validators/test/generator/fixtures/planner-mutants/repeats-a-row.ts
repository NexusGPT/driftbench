import { planted } from './wrap';

// The first new row is planned twice.
export const planV2 = planted((plan) => {
  const planned = plan.rows.filter((row) => row.source === 'planned');
  const first = planned[0];
  if (!first) return plan;
  const width = Math.max(3, String(planned.length + 1).length);
  const copy = { ...first, id: `row.${String(planned.length + 1).padStart(width, '0')}` };
  return { ...plan, generated: plan.generated + 1, rows: [...plan.rows, copy] };
});
