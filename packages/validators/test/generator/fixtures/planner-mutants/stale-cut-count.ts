import { planted } from './wrap';

// The report never counts the cut.
export const planV2 = planted((plan) => ({ ...plan, cut: 0 }));
