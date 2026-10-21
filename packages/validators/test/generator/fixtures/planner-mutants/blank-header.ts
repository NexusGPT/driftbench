import { planted } from './wrap';

// The report is blank: no rules, no agent, no version, a zero seed, nothing built or cut.
export const planV2 = planted((plan) => ({
  ...plan,
  agent: '',
  version: '',
  seed: 0,
  generated: 0,
  cut: 0,
  rules: [],
}));
