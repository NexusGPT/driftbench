import { planted } from './wrap';

// value_unreachable says the value is not required, whatever the store says.
export const planV2 = planted((plan) => ({
  ...plan,
  warnings: plan.warnings.map((warning) =>
    warning.code === 'value_unreachable' ? { ...warning, required: false } : warning,
  ),
}));
