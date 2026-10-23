import { refusing } from './zero-weights-variant';

// The review's variant: a RangeError with the right words and another code.
export const planV2 = refusing((id) =>
  Object.assign(new RangeError(`VARIABLES_WEIGHT_ZERO: every value of "${id}" weighs 0`), {
    code: 'VARIABLES_WEIGHT_INCOMPLETE',
  }),
);
