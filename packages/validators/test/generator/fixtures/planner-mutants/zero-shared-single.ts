import { planted } from './wrap';

// The real rows and the real `own` report, but every count of `shared` and `single` is zero, on every call.
export const planV2 = planted((plan) => ({
  ...plan,
  layers: plan.layers.map((layer) =>
    layer.layer === 'own'
      ? layer
      : { ...layer, groups: 0, targets: 0, infeasible: 0, seeded: 0, covered: 0, uncovered: 0 },
  ),
}));
