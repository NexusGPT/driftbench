import { planted } from './wrap';

// The budget does nothing.
export const planV2 = planted(
  (plan) => plan,
  ({ budget: _budget, ...rest }) => rest,
);
