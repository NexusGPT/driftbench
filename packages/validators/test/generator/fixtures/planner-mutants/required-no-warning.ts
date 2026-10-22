import { requiredFirst } from './required-first';

// A budget that leaves a required value in no row says nothing.
export const planV2 = requiredFirst('first', false);
