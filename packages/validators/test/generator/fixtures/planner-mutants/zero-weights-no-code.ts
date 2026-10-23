import { refusing } from './zero-weights-variant';

// The review's variant: a RangeError with the right words and no code.
export const planV2 = refusing((id) => new RangeError(`VARIABLES_WEIGHT_ZERO: every value of "${id}" weighs 0`));
