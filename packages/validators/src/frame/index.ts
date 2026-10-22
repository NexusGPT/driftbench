/**
 * The frame of the validators: the product runs apart, the parent decides (docs/validators.md, the section of that
 * name). A ladder that calls the product through `isolate` or `isolateCommand` gets the product's answers as
 * recorded data from two child processes that differ in every signal a product could read about how it is run.
 */
export {
  describeSeal,
  finishInvocation,
  forgetSealedProducts,
  RESOLUTION_CONFIG_NAMES,
  type SealDescriptor,
} from './confine';
export {
  type Ambient,
  type CommandOptions,
  type CommandRun,
  type Frame,
  type Guard,
  type IsolateOptions,
  isolate,
  isolateCommand,
  type Keep,
} from './isolate';
export { canonical, decode, type Entry, encode, FrameError, type Outcome, replay, type Tape } from './tape';
export { neutralName, rngOf, type TwinPlan, twinPlans } from './twins';
