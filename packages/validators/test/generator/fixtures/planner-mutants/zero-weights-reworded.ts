import { refusing } from './zero-weights-variant';

// A correct planner in other words: a RangeError whose code is VARIABLES_WEIGHT_ZERO, its message reworded.
export const planV2 = refusing((id) =>
  Object.assign(new RangeError(`the weights of ${id} add up to nothing`), { code: 'VARIABLES_WEIGHT_ZERO' }),
);
