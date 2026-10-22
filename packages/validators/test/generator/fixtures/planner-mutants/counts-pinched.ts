import { planted } from './wrap';

// A combination no valid row extends is counted as a target the rows leave uncovered.
export const planV2 = planted((plan) => ({
  ...plan,
  layers: plan.layers.map((layer) =>
    layer.layer === 'shared'
      ? {
          ...layer,
          targets: layer.targets + 1,
          infeasible: layer.infeasible - 1,
          uncovered: layer.uncovered + 1,
        }
      : layer,
  ),
}));
