import { planted } from './wrap';

// The first planned row has an empty id, the same in every call.
export const planV2 = planted((plan) => {
  const at = plan.rows.findIndex((row) => row.source === 'planned');
  return at < 0
    ? plan
    : { ...plan, rows: plan.rows.map((row, index) => (index === at ? { ...row, id: '' } : row)) };
});
