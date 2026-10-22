import { requiredFirst } from './required-first';

// A budget cuts the required value first: its rows come last, after the rows without it.
export const planV2 = requiredFirst('last');
