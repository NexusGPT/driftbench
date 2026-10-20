import { planted } from './wrap';

// Seeds are not passed to the planner.
export const planV2 = planted(
  (plan) => plan,
  ({ seeds: _seeds, ...rest }) => rest,
);
