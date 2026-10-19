import type { VariablesImpl } from '../../src/ladders/variables/interface';

/** An implementation that ends the bank's child process with exit code 0 on its first call. */
const stop = () => process.exit(0);

export const variablesImpl: VariablesImpl = {
  buildStore: stop,
  plan: stop,
  coverage: stop,
  weightInterval: stop,
  validate: stop,
  quotes: stop,
};
