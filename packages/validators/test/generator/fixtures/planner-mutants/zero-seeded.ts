import { planted } from './wrap';

// The report never counts what the seeds hold.
export const planV2 = planted((plan) => ({
  ...plan,
  layers: plan.layers.map((layer) => ({ ...layer, seeded: 0 })),
}));
