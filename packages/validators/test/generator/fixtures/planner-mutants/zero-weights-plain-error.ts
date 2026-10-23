import { refusing } from './zero-weights-variant';

// The review's variant: a plain Error with the right words and the right code, not a RangeError.
export const planV2 = refusing((id) =>
  Object.assign(new Error(`VARIABLES_WEIGHT_ZERO: every value of "${id}" weighs 0`), {
    code: 'VARIABLES_WEIGHT_ZERO',
  }),
);
