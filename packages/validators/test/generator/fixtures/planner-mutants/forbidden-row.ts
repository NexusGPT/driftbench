import { planted } from './wrap';

// The first planned row holds a forbidden pair.
export const planV2 = planted((plan, store) => {
  const forbid = store.constraints.find((constraint) => constraint.approved)?.forbid;
  const at = plan.rows.findIndex((row) => row.source === 'planned');
  if (!forbid || at < 0) return plan;
  const rows = plan.rows.map((row, index) =>
    index === at ? { ...row, values: { ...row.values, ...forbid } } : row,
  );
  return { ...plan, rows };
});
