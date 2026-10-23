import { planted } from './wrap';

// A rule of three or more variables is reported without its last variable.
export const planV2 = planted((plan) => ({
  ...plan,
  rules: plan.rules.map((rule) =>
    rule.variables.length > 2 ? { ...rule, variables: rule.variables.slice(0, -1) } : rule,
  ),
}));
