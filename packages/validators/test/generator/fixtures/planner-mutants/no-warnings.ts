import { planted } from './wrap';

// The warnings are dropped.
export const planV2 = planted((plan) => ({ ...plan, warnings: [] }));
