import { planted } from './wrap';

// The last planned row is lost, so the tuples only it held are uncovered.
export const planV2 = planted((plan) => {
  const last = plan.rows.map((row) => row.source).lastIndexOf('planned');
  return last < 0 ? plan : { ...plan, rows: plan.rows.filter((_, index) => index !== last) };
});
