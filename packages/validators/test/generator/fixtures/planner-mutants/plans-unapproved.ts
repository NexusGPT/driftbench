import { planted } from './wrap';

// What nobody approved is planned too.
export const planV2 = planted(
  (plan) => plan,
  (options) => ({ ...options, approvedOnly: false }),
);
