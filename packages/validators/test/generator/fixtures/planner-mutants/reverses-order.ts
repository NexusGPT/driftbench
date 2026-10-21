import { planted } from './wrap';

// New rows come rarest first.
export const planV2 = planted((plan) => {
  const planned = plan.rows.filter((row) => row.source === 'planned').reverse();
  return { ...plan, rows: [...plan.rows.filter((row) => row.source === 'seed'), ...planned] };
});
